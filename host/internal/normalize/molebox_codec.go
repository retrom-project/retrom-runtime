package normalize

import (
	"bytes"
	"compress/zlib"
	"context"
	"encoding/binary"
	"io"

	"github.com/retrom-project/retrom-runtime/host/internal/content"
	"github.com/retrom-project/retrom-runtime/host/internal/rules"
)

const (
	moleboxImage    = 32 * 1024 * 1024
	moleboxStage    = 16 * 1024 * 1024
	moleboxMetadata = 16 * 1024 * 1024
	moleboxFile     = 8 * 1024 * 1024 * 1024
	moleboxTree     = 16 * 1024 * 1024 * 1024
	moleboxEntries  = 100000
	moleboxPackages = 64
	moleboxBlock    = 49152
)

func requireMolebox(value bool, code ...string) {
	if !value {
		name := "RUNTIME_MOLEBOX_INVALID"
		if len(code) > 0 {
			name = code[0]
		}
		panic(rules.Fail(name))
	}
}

func moleboxRange(data []byte, offset, length int64) []byte {
	requireMolebox(offset >= 0 && length >= 0 && offset <= int64(len(data)) && length <= int64(len(data))-offset)
	return data[offset : offset+length]
}

func readAt(ctx context.Context, handle *content.Handle, size, offset, length int64) []byte {
	if ctx.Err() != nil {
		panic(rules.Fail("RUNTIME_CANCELLED"))
	}
	requireMolebox(offset >= 0 && length >= 0 && offset <= size && length <= size-offset)
	data := make([]byte, length)
	for at := int64(0); at < length; {
		read, err := handle.ReadAt(data[at:], offset+at)
		requireMolebox(err == nil && read > 0)
		at += int64(read)
	}
	return data
}

// moleboxKey expands STEELBOX's 15-byte seed to eight 7-byte rounds and one 4-byte tail.
func moleboxKey(seed []byte) []byte {
	requireMolebox(len(seed) >= 15)
	var out []byte
	index := 11
	for range 9 {
		for offset := range 4 {
			out = append(out, seed[(index+offset)%15])
		}
		index = (index + 12) % 15
		if index == 12 {
			requireMolebox(len(out) == 60)
			return out
		}
		out = append(out, seed[index], seed[index+1], seed[index+2])
		index = (index + 11) % 15
	}
	panic(rules.Fail("RUNTIME_MOLEBOX_INVALID"))
}

func decodeMolebox(data, key, table []byte, cbc bool) []byte {
	requireMolebox(len(data)%8 == 0 && len(key) == 60 && len(table) == 256)
	output := append([]byte(nil), data...)
	var previous, a [8]byte
	for at := 0; at < len(output); at += 8 {
		copy(a[:], output[at:at+8])
		for round := range 8 {
			p := round * 7
			a[7] ^= table[a[3]^key[p+3]]
			a[4] ^= table[a[0]^key[p]]
			a[6] ^= table[a[2]^key[p+2]]
			a[5] ^= table[a[1]^key[p+1]]
			a[1] ^= table[a[4]^key[p+4]]
			a[2] ^= table[a[4]^a[5]]
			a[3] ^= table[a[6]^key[p+5]]
			a[0] ^= table[a[7]^key[p+6]]
		}
		for index := range 4 {
			a[index+4] ^= table[a[index]^key[56+index]]
		}
		for index := range 8 {
			cipher := output[at+index]
			output[at+index] = a[index]
			if cbc {
				output[at+index] ^= previous[index]
			}
			previous[index] = cipher
		}
	}
	return output
}

func unpackMoleboxStage(ctx context.Context, input []byte) []byte {
	requireMolebox(len(input) >= 4)
	size := int(binary.LittleEndian.Uint32(input))
	requireMolebox(size > 0 && size <= moleboxStage, "RUNTIME_MOLEBOX_LIMIT")
	output := make([]byte, size)
	at, out := 4, 0
	for out < size {
		if ctx.Err() != nil {
			panic(rules.Fail("RUNTIME_CANCELLED"))
		}
		requireMolebox(at+2 <= len(input))
		switch tag := input[at]; tag {
		case 128:
			output[out] = input[at+1]
			out++
			at += 2
		case 0:
			count := int(input[at+1]) + 1
			at += 2
			requireMolebox(at+count <= len(input) && out+count <= size)
			copy(output[out:], input[at:at+count])
			at += count
			out += count
		default:
			word := int(binary.LittleEndian.Uint16(input[at:]))
			count, distance := word&15, word>>4+15
			requireMolebox(count > 0 && distance <= out && count <= distance && out+count <= size)
			copy(output[out:out+count], output[out-distance:out-distance+count])
			at += 2
			out += count
		}
	}
	// The shipped LZ decoder stops at the declared length; its compressor leaves a short terminator tail.
	requireMolebox(len(input)-at <= 16)
	return output
}

func inflateMoleboxBlock(input []byte, size int) []byte {
	reader := bytes.NewReader(input)
	decoder, err := zlib.NewReader(reader)
	requireMolebox(err == nil)
	result, err := io.ReadAll(io.LimitReader(decoder, int64(size)+1))
	requireMolebox(err == nil && len(result) == size && reader.Len() < 8)
	return result
}

func moleboxCRC16(data []byte) uint16 {
	crc := uint16(0)
	for _, value := range data {
		crc ^= uint16(value)
		for range 8 {
			if crc&1 != 0 {
				crc = crc>>1 ^ 0xa001
			} else {
				crc >>= 1
			}
		}
	}
	return crc
}
