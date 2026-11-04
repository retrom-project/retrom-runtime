package kirikiri

import (
	"encoding/binary"
	"encoding/hex"
	"math/bits"
	"sort"

	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/blake2s"
	"golang.org/x/crypto/chacha20poly1305"
	"golang.org/x/crypto/sha3"
)

// Native protocol cross-check: xp3-brute 0.3.7 (MIT), krkr_exe.rs/hxv4.rs. All title inputs come from the PE.

func quarter(x *[16]uint32, a, b, c, d int) {
	x[a] += x[b]
	x[d] = bits.RotateLeft32(x[d]^x[a], 16)
	x[c] += x[d]
	x[b] = bits.RotateLeft32(x[b]^x[c], 12)
	x[a] += x[b]
	x[d] = bits.RotateLeft32(x[d]^x[a], 8)
	x[c] += x[d]
	x[b] = bits.RotateLeft32(x[b]^x[c], 7)
}

func chacha(state [16]uint32, doubleRounds int) [16]uint32 {
	x := state
	for range doubleRounds {
		quarter(&x, 0, 4, 8, 12)
		quarter(&x, 1, 5, 9, 13)
		quarter(&x, 2, 6, 10, 14)
		quarter(&x, 3, 7, 11, 15)
		quarter(&x, 0, 5, 10, 15)
		quarter(&x, 1, 6, 11, 12)
		quarter(&x, 2, 7, 8, 13)
		quarter(&x, 3, 4, 9, 14)
	}
	return x
}

func words(data []byte) []uint32 {
	result := make([]uint32, len(data)/4)
	for index := range result {
		result[index] = binary.LittleEndian.Uint32(data[index*4:])
	}
	return result
}

var chachaConstant = words([]byte("expand 32-byte k"))

func bytes32(values []uint32) []byte {
	result := make([]byte, len(values)*4)
	for index, value := range values {
		binary.LittleEndian.PutUint32(result[index*4:], value)
	}
	return result
}

// decryptBres decrypts a bres:// resource with the module's salt.
func decryptBres(input []byte, path string, salt []byte) []byte {
	require(len(salt) == 8192 && len(input) <= maximumIndex && len(path) > 0 && rulesLength(path) <= 4096)
	hash := sha3.New384()
	hash.Write(utf16le(path))
	hash.Write(salt)
	m := words(hash.Sum(nil))
	output := make([]byte, len(input))
	for at := 0; at < len(input); at += 64 {
		var initial [16]uint32
		copy(initial[:4], chachaConstant)
		copy(initial[4:12], m[:8])
		initial[12], initial[13], initial[14], initial[15] = m[10]^uint32(at/64), m[11], m[8], m[9]
		mixed := chacha(initial, 4)
		stream := make([]uint32, 16)
		for index := range stream {
			stream[index] = mixed[index] + initial[index]
		}
		block := bytes32(stream)
		for index := range min(64, len(input)-at) {
			output[at+index] = input[at+index] ^ block[index]
		}
	}
	return output
}

func keyBlock(input []byte, seed uint32) []byte {
	var w [8]uint32
	state := 0x01000193 * (seed ^ 0x811c9dc5)
	for index, value := range input {
		v := uint32(value) ^ state
		v = (v ^ v>>17) * 0xed5ad4bb
		v = (v ^ v>>11) * 0xac4c1b51
		v = (v ^ v>>15) * 0x31848bab
		state = v ^ v>>14
		w[index%8] ^= state
	}
	hash, _ := blake2s.New256(nil)
	hash.Write(input)
	hash.Write(bytes32(w[:]))
	return hash.Sum(nil)
}

func xorBytes(left, right []byte) []byte {
	result := make([]byte, len(left))
	for index := range left {
		result[index] = left[index] ^ right[index]
	}
	return result
}

// validHXParams: three permutations of 0..7, 0..5 and 0..2 in a 22-byte block.
func validHXParams(params []byte) bool {
	if len(params) != 22 {
		return false
	}
	for _, span := range [][2]int{{0, 8}, {8, 14}, {14, 17}} {
		part := append([]byte(nil), params[span[0]:span[1]]...)
		sort.Slice(part, func(i, j int) bool { return part[i] < part[j] })
		for index, value := range part {
			if int(value) != index {
				return false
			}
		}
	}
	return true
}

type hxMaterial struct {
	key, nonce0, nonce1 []byte
	table               []uint32
	params              []byte
}

func deriveHXMaterial(params []byte, prefix, warning, unique string, archiveSeed []byte) *hxMaterial {
	require(validHXParams(params) && len(archiveSeed) == 8 && len(utf16le(prefix)) <= 2*32767 &&
		len(utf16le(warning)) <= 2*32767 && len(utf16le(unique)) <= 2*32767)
	bootstrap := utf16le(prefix + warning)
	saltHash := sha3.Sum224(params)
	material := argon2.Key(bootstrap, saltHash[:16], 3, 8, 1, 64)
	key := xorBytes(keyBlock(bootstrap, 0), material)
	nonce1 := xorBytes(keyBlock(params, 1), material)[:24]
	nonce0 := xorBytes(keyBlock(utf16le(unique), 2), keyBlock(archiveSeed, binary.LittleEndian.Uint32(archiveSeed)))[:24]
	expanded := make([]byte, 8192)
	shake := sha3.NewShake256()
	shake.Write(material)
	_, _ = shake.Read(expanded)
	table := make([]uint32, 1024)
	for index := range table {
		value := binary.LittleEndian.Uint32(expanded[index*4:])
		if params[17]&1 != 0 {
			value ^= binary.LittleEndian.Uint32(expanded[4096+index*4:])
		}
		table[index] = value
	}
	return &hxMaterial{key: key, nonce0: nonce0, nonce1: nonce1, table: table, params: params}
}

func decryptHXPayload(payload, key, nonce []byte) view {
	require(len(payload) >= 16 && len(payload) <= maximumIndex && len(key) == 32 && len(nonce) == 24)
	var state [16]uint32
	copy(state[:4], chachaConstant)
	copy(state[4:12], words(key))
	copy(state[12:], words(nonce[:16]))
	sub := chacha(state, 10)
	subkey := bytes32([]uint32{sub[0], sub[1], sub[2], sub[3], sub[12], sub[13], sub[14], sub[15]})
	iv := append(make([]byte, 4), nonce[16:]...)
	aead, err := chacha20poly1305.New(subkey)
	require(err == nil)
	sealed := append(append([]byte(nil), payload[16:]...), payload[:16]...)
	plain, err := aead.Open(nil, iv, sealed, nil)
	if err != nil {
		panic(fail("HXV4_AUTHENTICATION_FAILED"))
	}
	require(len(plain) >= 4)
	return inflate(plain[4:], int64(binary.LittleEndian.Uint32(plain)))
}

type hxRecord struct {
	pathHash, fileHash []byte
	entryID            uint32
	archiveSlot        int
	localFlags         int
	entryKey           uint64
	fileIndex          int
}

// parseHXTable reads the restricted big-endian TJS Variant tree.
func parseHXTable(data view) []*hxRecord {
	at := 0
	take := func(size int) view {
		require(size >= 0 && at+size <= len(data))
		value := data[at : at+size]
		at += size
		return value
	}
	array := func() int {
		require(take(1)[0] == 0x81)
		count := int(int32(binary.BigEndian.Uint32(take(4))))
		require(count >= 0 && count <= 500000)
		return count
	}
	octet := func(size int) []byte {
		require(take(1)[0] == 3 && int(int32(binary.BigEndian.Uint32(take(4)))) == size)
		return append([]byte(nil), take(size)...)
	}
	integer := func() int64 {
		require(take(1)[0] == 4)
		return int64(binary.BigEndian.Uint64(take(8)))
	}
	domains := array()
	require(domains > 0 && domains%2 == 0)
	var records []*hxRecord
	seen := map[string]bool{}
	for index := 0; index < domains; index += 2 {
		pathHash, count := octet(8), array()
		require(count > 0 && count%2 == 0)
		for item := 0; item < count; item += 2 {
			fileHash := octet(32)
			require(array() == 2)
			packed, entryKey := integer(), uint64(integer())
			require(packed >= 0)
			identity := hex.EncodeToString(pathHash) + ":" + hex.EncodeToString(fileHash)
			require(!seen[identity], "NAME_MAP_INVALID")
			seen[identity] = true
			records = append(records, &hxRecord{
				pathHash: pathHash, fileHash: fileHash, entryID: uint32(packed),
				archiveSlot: int(packed >> 48), localFlags: int(packed >> 32 & 65535), entryKey: entryKey,
			})
			require(len(records) <= 250000, "ARCHIVE_LIMIT")
		}
	}
	require(at == len(data) && len(records) > 0)
	return records
}

func encodeHXNamespace(mediaName string, records []*hxRecord) []byte {
	valid := mediaName != "" && rulesLength(mediaName) <= 256
	for _, character := range mediaName {
		valid = valid && character > 32 && character != 127 && character != '/' && character != '\\' && character != ':'
	}
	require(valid)
	require(len(records) > 0 && len(records) <= 250000, "ARCHIVE_LIMIT")
	media := utf16le(mediaName)
	result := make([]byte, 8+len(media)+len(records)*52)
	binary.LittleEndian.PutUint32(result, uint32(len(media)/2))
	copy(result[4:], media)
	binary.LittleEndian.PutUint32(result[4+len(media):], uint32(len(records)))
	at := 8 + len(media)
	for _, record := range records {
		require(len(record.pathHash) == 8 && len(record.fileHash) == 32 && record.archiveSlot == 0 && record.fileIndex >= 0)
		copy(result[at:], record.pathHash)
		copy(result[at+8:], record.fileHash)
		binary.LittleEndian.PutUint32(result[at+40:], record.entryID)
		binary.LittleEndian.PutUint16(result[at+44:], uint16(record.archiveSlot))
		binary.LittleEndian.PutUint16(result[at+46:], uint16(record.localFlags))
		binary.LittleEndian.PutUint32(result[at+48:], uint32(record.fileIndex))
		at += 52
	}
	return result
}

func rulesLength(text string) int { return len(utf16le(text)) / 2 }
