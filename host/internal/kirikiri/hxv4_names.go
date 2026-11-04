package kirikiri

import (
	"encoding/binary"
	"encoding/hex"
	"math/bits"
	"regexp"
	"unicode/utf16"

	"golang.org/x/crypto/blake2s"
)

func sipRound(s *[4]uint64) {
	s[0] += s[1]
	s[1] = bits.RotateLeft64(s[1], 13) ^ s[0]
	s[0] = bits.RotateLeft64(s[0], 32)
	s[2] += s[3]
	s[3] = bits.RotateLeft64(s[3], 16) ^ s[2]
	s[0] += s[3]
	s[3] = bits.RotateLeft64(s[3], 21) ^ s[0]
	s[2] += s[1]
	s[1] = bits.RotateLeft64(s[1], 17) ^ s[2]
	s[2] = bits.RotateLeft64(s[2], 32)
}

// hxPathHash performs no case, Unicode or extension rewriting, as the native hash.
func hxPathHash(path, media string) []byte {
	data := utf16le(path + media)
	s := [4]uint64{0x736f6d6570736575, 0x646f72616e646f6d, 0x6c7967656e657261, 0x7465646279746573}
	at := 0
	for ; at+8 <= len(data); at += 8 {
		m := binary.LittleEndian.Uint64(data[at:])
		s[3] ^= m
		sipRound(&s)
		sipRound(&s)
		s[0] ^= m
	}
	end := uint64(len(data)&255) << 56
	for index := at; index < len(data); index++ {
		end |= uint64(data[index]) << (8 * (index - at))
	}
	s[3] ^= end
	sipRound(&s)
	sipRound(&s)
	s[0] ^= end
	s[2] ^= 255
	for range 4 {
		sipRound(&s)
	}
	result := make([]byte, 8)
	binary.LittleEndian.PutUint64(result, s[0]^s[1]^s[2]^s[3])
	return result
}

func hxFileHash(name, media string) []byte {
	sum := blake2s.Sum256(utf16le(name + media))
	return sum[:]
}

// hxEntryID decodes an entry name of 1-3 CJK-range units to its numeric ID.
func hxEntryID(name string) (uint32, bool) {
	units := utf16.Encode([]rune(name))
	if len(units) == 0 || len(units) > 3 {
		return 0, false
	}
	id := uint64(0)
	for index, unit := range units {
		if unit < 0x5000 || unit > 0x8fff {
			return 0, false
		}
		id |= uint64(unit-0x5000) << (14 * index)
	}
	if id > 0xffffffff || len(units) > 1 && units[len(units)-1] == 0x5000 {
		return 0, false
	}
	return uint32(id), true
}

var mediaPattern = regexp.MustCompile(`(?i)^[a-z\d._-]{1,256}$`)

func selectHXMedia(strings []string, records []*hxRecord) string {
	identities := map[string]bool{}
	for _, record := range records {
		identities[hex.EncodeToString(record.pathHash)+":"+hex.EncodeToString(record.fileHash)] = true
	}
	seen := map[string]bool{}
	var valid []string
	for _, media := range strings {
		if !mediaPattern.MatchString(media) || seen[media] {
			continue
		}
		seen[media] = true
		if identities[hex.EncodeToString(hxPathHash("", media))+":"+hex.EncodeToString(hxFileHash("startup.tjs", media))] {
			valid = append(valid, media)
		}
	}
	require(len(valid) == 1, "HXV4_HASHER_UNSUPPORTED")
	return valid[0]
}
