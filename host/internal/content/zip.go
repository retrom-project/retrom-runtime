package content

import (
	"compress/flate"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"hash"
	"hash/crc32"
	"io"
	"strings"

	"github.com/retrom-project/retrom-runtime/host/internal/rules"
	"github.com/retrom-project/retrom-runtime/host/internal/textcodec"
)

const (
	endSignature     = 0x06054b50
	centralSignature = 0x02014b50
	localSignature   = 0x04034b50
	maxComment       = 65557
	maxDirectory     = 64 * 1024 * 1024
	maxExpanded      = 512 * 1024 * 1024
)

// MemberOptions select optional digest evidence.
type MemberOptions struct{ Digests bool }

// Members lists a ZIP's central directory; with digests every member is inflated and verified.
func Members(locator *Locator, options MemberOptions) ([]rules.ArchiveMember, error) {
	handle, err := Open(locator)
	if err != nil {
		return nil, err
	}
	defer func() { _ = handle.Close() }()
	return handleMembers(handle, options)
}

func handleMembers(handle *Handle, options MemberOptions) ([]rules.ArchiveMember, error) {
	invalid := rules.Fail("RUNTIME_ARCHIVE_INVALID")
	length := min(handle.Size(), maxComment)
	tail := make([]byte, length)
	if _, err := handle.ReadAt(tail, handle.Size()-length); err != nil {
		return nil, err
	}
	end := -1
	for index := len(tail) - 22; index >= 0; index-- {
		if binary.LittleEndian.Uint32(tail[index:]) == endSignature {
			end = index
			break
		}
	}
	if end < 0 || binary.LittleEndian.Uint16(tail[end+4:]) != 0 || binary.LittleEndian.Uint16(tail[end+6:]) != 0 {
		return nil, invalid
	}
	count := int(binary.LittleEndian.Uint16(tail[end+10:]))
	size := int64(binary.LittleEndian.Uint32(tail[end+12:]))
	offset := int64(binary.LittleEndian.Uint32(tail[end+16:]))
	if count == 65535 || size > maxDirectory || offset+size > handle.Size() {
		return nil, rules.Fail("RUNTIME_ARCHIVE_LIMIT")
	}
	directory := make([]byte, size)
	if _, err := handle.ReadAt(directory, offset); err != nil {
		return nil, err
	}
	return parseDirectory(handle, directory, offset, count, options)
}

func parseDirectory(handle *Handle, directory []byte, offset int64, count int, options MemberOptions,
) ([]rules.ArchiveMember, error) {
	invalid := rules.Fail("RUNTIME_ARCHIVE_INVALID")
	size := len(directory)
	result := []rules.ArchiveMember{}
	names := map[string]bool{}
	at, expanded := 0, int64(0)
	for range count {
		if at+46 > size || binary.LittleEndian.Uint32(directory[at:]) != centralSignature ||
			binary.LittleEndian.Uint16(directory[at+8:])&1 != 0 {
			return nil, invalid
		}
		nameLength := int(binary.LittleEndian.Uint16(directory[at+28:]))
		extra := int(binary.LittleEndian.Uint16(directory[at+30:]))
		comment := int(binary.LittleEndian.Uint16(directory[at+32:]))
		if at+46+nameLength+extra+comment > size {
			return nil, invalid
		}
		name, err := DecodeZIPName(directory[at+46:at+46+nameLength], binary.LittleEndian.Uint16(directory[at+8:]),
			directory[at+46+nameLength:at+46+nameLength+extra])
		if err != nil || !rules.SafePath(strings.TrimSuffix(name, "/")) || names[name] {
			return nil, invalid
		}
		names[name] = true
		if !strings.HasSuffix(name, "/") {
			member, err := directoryMember(handle, directory[at:], name, offset, options, &expanded)
			if err != nil {
				return nil, err
			}
			result = append(result, *member)
		}
		at += 46 + nameLength + extra + comment
	}
	if at != size {
		return nil, invalid
	}
	return result, nil
}

// directoryMember builds one file member; digest evidence counts against the total expansion budget.
func directoryMember(handle *Handle, entry []byte, name string, offset int64, options MemberOptions, expanded *int64,
) (*rules.ArchiveMember, error) {
	member := &rules.ArchiveMember{
		Name: name, SizeBytes: int64(binary.LittleEndian.Uint32(entry[24:])),
		CRC32: fmt.Sprintf("%08x", binary.LittleEndian.Uint32(entry[16:])),
	}
	if !options.Digests {
		return member, nil
	}
	*expanded += member.SizeBytes
	if *expanded > maxExpanded {
		return nil, rules.Fail("RUNTIME_ARCHIVE_LIMIT")
	}
	if err := memberDigests(handle, entry, member, offset); err != nil {
		return nil, err
	}
	return member, nil
}

type boundedHasher struct {
	limit   int64
	size    int64
	crc     uint32
	sha1    hash.Hash
	sha256  hash.Hash
	overrun bool
}

func (h *boundedHasher) Write(data []byte) (int, error) {
	h.size += int64(len(data))
	if h.size > h.limit {
		h.overrun = true
		return 0, rules.Fail("RUNTIME_ARCHIVE_LIMIT")
	}
	h.crc = crc32.Update(h.crc, crc32.IEEETable, data)
	h.sha1.Write(data)
	h.sha256.Write(data)
	return len(data), nil
}

// consume inflates or copies the stored bytes into the hasher; overrunning the declared size is a limit failure.
func (h *boundedHasher) consume(handle *Handle, method uint16, start, compressed int64) error {
	if compressed == 0 {
		return nil
	}
	source := io.Reader(&sectionReader{handle: handle, position: start, end: start + compressed})
	if method == 8 {
		source = flate.NewReader(source)
	}
	if _, err := io.Copy(h, source); err != nil {
		if h.overrun {
			return rules.Fail("RUNTIME_ARCHIVE_LIMIT")
		}
		return rules.Fail("RUNTIME_ARCHIVE_INVALID")
	}
	return nil
}

// memberDigests hashes inflated members in bounded chunks; a central-directory CRC is never content evidence.
func memberDigests(handle *Handle, entry []byte, member *rules.ArchiveMember, directoryOffset int64) error {
	invalid := rules.Fail("RUNTIME_ARCHIVE_INVALID")
	method := binary.LittleEndian.Uint16(entry[10:])
	compressed := int64(binary.LittleEndian.Uint32(entry[20:]))
	offset := int64(binary.LittleEndian.Uint32(entry[42:]))
	header := make([]byte, 30)
	read, err := handle.ReadAt(header, offset)
	if err != nil {
		return err
	}
	if read != 30 || binary.LittleEndian.Uint32(header) != localSignature ||
		binary.LittleEndian.Uint16(header[6:])&1 != 0 ||
		binary.LittleEndian.Uint16(header[8:]) != method || method != 0 && method != 8 {
		return invalid
	}
	start := offset + 30 + int64(binary.LittleEndian.Uint16(header[26:])) + int64(binary.LittleEndian.Uint16(header[28:]))
	if start > directoryOffset || compressed > directoryOffset-start {
		return invalid
	}
	hasher := &boundedHasher{limit: member.SizeBytes, sha1: sha1.New(), sha256: sha256.New()}
	if err := hasher.consume(handle, method, start, compressed); err != nil {
		return err
	}
	if hasher.size != member.SizeBytes || fmt.Sprintf("%08x", hasher.crc) != member.CRC32 {
		return invalid
	}
	member.SHA1, member.SHA256 = hex.EncodeToString(hasher.sha1.Sum(nil)), hex.EncodeToString(hasher.sha256.Sum(nil))
	return nil
}

type sectionReader struct {
	handle   *Handle
	position int64
	end      int64
}

func (r *sectionReader) Read(buffer []byte) (int, error) {
	if r.position >= r.end {
		return 0, io.EOF
	}
	chunk := buffer[:min(int64(len(buffer)), r.end-r.position, 65536)]
	read, err := r.handle.ReadAt(chunk, r.position)
	if err != nil {
		return read, err
	}
	if read != len(chunk) {
		return read, rules.Fail("RUNTIME_ARCHIVE_INVALID")
	}
	r.position += int64(read)
	return read, nil
}

const cp437 = "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐" +
	"└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ "

var errZIPName = rules.Fail("ZIP_FILENAME_INVALID")

// DecodeZIPName prefers explicit Unicode metadata; unmarked Chinese archives retain their GB18030 names.
func DecodeZIPName(name []byte, flags uint16, extra []byte) (string, error) {
	if flags&0x800 != 0 {
		return strictText(name, "utf-8")
	}
	unicode, found, err := unicodePath(name, extra)
	if err != nil {
		return "", err
	}
	if found {
		return unicode, nil
	}
	for _, encoding := range []string{"utf-8", "gb18030"} {
		if text, err := strictText(name, encoding); err == nil {
			return text, nil
		}
	}
	table := []rune(cp437)
	var builder strings.Builder
	for _, value := range name {
		if value < 128 {
			builder.WriteByte(value)
		} else {
			builder.WriteRune(table[value-128])
		}
	}
	return builder.String(), nil
}

func strictText(data []byte, encoding string) (string, error) {
	text, ok := textcodec.Decode(data, encoding, true)
	if !ok {
		return "", errZIPName
	}
	return text, nil
}

func unicodePath(name, extra []byte) (string, bool, error) {
	for at := 0; at < len(extra); {
		if at+4 > len(extra) {
			return "", false, errZIPName
		}
		tag, length := binary.LittleEndian.Uint16(extra[at:]), int(binary.LittleEndian.Uint16(extra[at+2:]))
		start := at + 4
		if start+length > len(extra) {
			return "", false, errZIPName
		}
		if tag == 0x7075 && length >= 5 && extra[start] == 1 &&
			binary.LittleEndian.Uint32(extra[start+1:]) == crc32.ChecksumIEEE(name) {
			text, err := strictText(extra[start+5:start+length], "utf-8")
			return text, err == nil, err
		}
		at = start + length
	}
	return "", false, nil
}
