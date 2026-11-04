package normalize

import (
	"context"
	"encoding/binary"

	"github.com/retrom-project/retrom-runtime/host/internal/content"
	"github.com/retrom-project/retrom-runtime/host/internal/rules"
)

const (
	enigmaMetadata  = 8 * 1024 * 1024
	enigmaBootstrap = 1024 * 1024
	enigmaEntries   = 100000
	enigmaFile      = 8 * 1024 * 1024 * 1024
	enigmaTree      = 64 * 1024 * 1024 * 1024
)

func requireEnigma(value bool, code ...string) {
	if !value {
		name := "INVALID"
		if len(code) > 0 {
			name = code[0]
		}
		panic(rules.Fail("RUNTIME_ENIGMA_" + name))
	}
}

func enigmaRange(data []byte, at, length int64) bytesView {
	requireEnigma(at >= 0 && length >= 0 && length <= int64(len(data))-at)
	return data[at : at+length]
}

func enigmaNumber(data []byte, at int64) int64 {
	value := binary.LittleEndian.Uint64(enigmaRange(data, at, 8))
	requireEnigma(value <= 1<<53-1)
	return int64(value)
}

func readEnigma(ctx context.Context, handle *content.Handle, size, at, length int64) bytesView {
	if ctx.Err() != nil {
		panic(rules.Fail("RUNTIME_CANCELLED"))
	}
	requireEnigma(at >= 0 && length >= 0 && length <= size-at)
	data := make([]byte, length)
	for filled := int64(0); filled < length; {
		read, err := handle.ReadAt(data[filled:], at+filled)
		requireEnigma(err == nil && read > 0)
		filled += int64(read)
	}
	return data
}

func enigmaSchedule(key []byte) []byte {
	requireEnigma(len(key) > 0 && len(key) <= 256)
	state := make([]byte, 256)
	for index := range state {
		state[index] = byte(index)
	}
	j := 0
	for index := range 256 {
		j = (j + int(state[index]) + int(key[index%len(key)])) & 255
		state[index], state[j] = state[j], state[index]
	}
	return state
}

// enigmaCrypt applies a complete stored PRGA state, resetting both indices for every record/block.
func enigmaCrypt(data, initial []byte) bytesView {
	if initial == nil {
		return data
	}
	requireEnigma(len(initial) == 256)
	state := append([]byte(nil), initial...)
	out := make([]byte, len(data))
	i, j := 0, 0
	for p := range data {
		i = (i + 1) & 255
		j = (j + int(state[i])) & 255
		state[i], state[j] = state[j], state[i]
		out[p] = data[p] ^ state[(int(state[i])+int(state[j]))&255]
	}
	return out
}

type depacker struct {
	input     []byte
	out       []byte
	at, count int
	tag, bits int
	previous  int
	lwm       int
}

func (d *depacker) byte() int {
	requireEnigma(d.at < len(d.input))
	value := d.input[d.at]
	d.at++
	return int(value)
}

func (d *depacker) bit() int {
	if d.bits == 0 {
		d.tag, d.bits = d.byte(), 8
	}
	value := d.tag >> 7
	d.tag = d.tag << 1 & 255
	d.bits--
	return value
}

func (d *depacker) gamma() int {
	value := 1
	for {
		value = value*2 + d.bit()
		requireEnigma(value <= 0x7fffffff, "LIMIT")
		if d.bit() == 0 {
			return value
		}
	}
}

func (d *depacker) copy(distance, length int) {
	requireEnigma(distance > 0 && distance <= d.count && length > 0 && length <= len(d.out)-d.count)
	for range length {
		d.out[d.count] = d.out[d.count-distance]
		d.count++
	}
}

// prefix reads the unary token prefix 0, 10, 110 or 111 and returns its count of one bits.
func (d *depacker) prefix() int {
	for count := range 3 {
		if d.bit() == 0 {
			return count
		}
	}
	return 3
}

// match decodes a gamma-coded match; a zero offset reuses the previous distance.
func (d *depacker) match() {
	distance := d.gamma()
	if d.lwm != 0 {
		distance--
	} else {
		distance -= 2
	}
	length := 0
	if distance == 0 {
		distance, length = d.previous, d.gamma()
	} else {
		requireEnigma(distance > 0)
		distance = (distance-1)*256 + d.byte()
		length = d.gamma() + matchBonus(distance)
		d.previous = distance
	}
	d.copy(distance, length)
	d.lwm = 1
}

func matchBonus(distance int) int {
	bonus := 0
	if distance >= 32000 {
		bonus++
	}
	if distance >= 1280 {
		bonus++
	}
	if distance < 128 {
		bonus += 2
	}
	return bonus
}

// shortMatch decodes a one-byte match; it reports true at the end-of-stream marker.
func (d *depacker) shortMatch(dwordPadding bool) bool {
	value := d.byte()
	distance := value >> 1
	if distance == 0 {
		// Only the bootstrap XOR loop rounds its compressed input to DWORDs.
		padded := dwordPadding && len(d.input)%4 == 0 && len(d.input)-d.at < 4 && allZero(d.input[d.at:])
		requireEnigma(d.count == len(d.out) && (d.at == len(d.input) || padded))
		return true
	}
	d.copy(distance, 2+value&1)
	d.previous, d.lwm = distance, 1
	return false
}

// nibble copies one byte from a 4-bit distance, or writes zero.
func (d *depacker) nibble() {
	distance := 0
	for range 4 {
		distance = distance*2 + d.bit()
	}
	requireEnigma(d.count < len(d.out) && distance <= d.count)
	if distance != 0 {
		d.out[d.count] = d.out[d.count-distance]
	} else {
		d.out[d.count] = 0
	}
	d.count++
	d.lwm = 0
}

func (d *depacker) literal() {
	requireEnigma(d.count < len(d.out))
	d.out[d.count] = byte(d.byte())
	d.count++
	d.lwm = 0
}

// enigmaDepack is a bounded aPLib stream with explicit output and input termination checks.
func enigmaDepack(ctx context.Context, input []byte, size int, dwordPadding bool) bytesView {
	requireEnigma(size > 0 && size <= enigmaMetadata, "LIMIT")
	d := &depacker{input: input, out: make([]byte, size)}
	d.out[d.count] = byte(d.byte())
	d.count++
	for operations := 0; ; operations++ {
		if operations&4095 == 0 && ctx.Err() != nil {
			panic(rules.Fail("RUNTIME_CANCELLED"))
		}
		requireEnigma(operations < size*2+16, "LIMIT")
		switch d.prefix() {
		case 0:
			d.literal()
		case 1:
			d.match()
		case 2:
			if d.shortMatch(dwordPadding) {
				return d.out
			}
		default:
			d.nibble()
		}
	}
}

func allZero(data []byte) bool {
	for _, value := range data {
		if value != 0 {
			return false
		}
	}
	return true
}
