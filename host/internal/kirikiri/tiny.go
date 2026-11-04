package kirikiri

import (
	"bytes"
	"fmt"
)

func xorIs(data view, at, to, from int) bool {
	return data.at(at) == 0x32 && data.at(at+1) == 0xc0|to<<3|from || data.at(at) == 0x30 &&
		data.at(at+1) == 0xc0|from<<3|to
}

type fold struct{ zeroFallback, zeroAt, end, base int }

type foldRegisters struct {
	high, middle, low *move
	interleaved       bool
}

// copied reports a byte-addressable copy of source into a register distinct from earlier copies.
func copied(value *move, source int, earlier ...*move) bool {
	if value == nil || value.from != source || value.to == source || value.to > 3 {
		return false
	}
	for _, other := range earlier {
		if value.to == other.to {
			return false
		}
	}
	return true
}

// foldMoves recovers the three source copies of the SHR/XOR chain, or nil.
func foldMoves(data view, at, source int) *foldRegisters {
	high, middle := registerMove(data, at), registerMove(data, at+5)
	interleaved := registerMove(data, at+10)
	low := interleaved
	if low == nil {
		low = registerMove(data, at+12)
	}
	if !copied(high, source) || !copied(middle, source, high) || !copied(low, source, high) ||
		interleaved != nil && low.to == middle.to {
		return nil
	}
	return &foldRegisters{high: high, middle: middle, low: low, interleaved: interleaved != nil}
}

func foldChain(data view, at, source int, registers *foldRegisters) bool {
	xorAt := at + 10
	if registers.interleaved {
		xorAt = at + 12
	}
	high, middle, low := registers.high.to, registers.middle.to, registers.low.to
	return shiftIs(data, at+2, high, 24) && shiftIs(data, at+7, middle, 16) && xorIs(data, xorAt, high, middle) &&
		shiftIs(data, at+14, low, 8) && xorIs(data, at+17, high, low) && xorIs(data, at+19, high, source)
}

func foldStore(data view, p, source, base int, registers *foldRegisters) bool {
	if base == 4 || base == source || base == registers.high.to || base == registers.middle.to ||
		base == registers.low.to {
		return false
	}
	return data.at(p) == 0x88 && data.at(p+1) == 0x40|registers.high.to<<3|base && data.at(p+2) == 4
}

func tinyFold(data view, at, source, end int) *fold {
	if at+31 > end || source > 3 {
		return nil
	}
	registers := foldMoves(data, at, source)
	if registers == nil || !foldChain(data, at, source, registers) {
		return nil
	}
	p := at + 21
	base := data.bit(p+1) & 7
	if !foldStore(data, p, source, base, registers) {
		return nil
	}
	next := branch(data, p+3, end)
	if next == nil || next.op != 0x75 {
		return nil
	}
	z := p + 3 + next.length
	if z+4 > end || data.at(z) != 0xc6 || data.at(z+1) != 0x40|base || data.at(z+2) != 4 || data.bit(z+3) == 0 ||
		next.target != z+4 {
		return nil
	}
	return &fold{zeroFallback: int(data[z+3]), zeroAt: z, end: z + 4, base: base}
}

var tinyPrefix = []byte{
	0x8b, 0x44, 0x24, 12, 0x8b, 0x54, 0x24, 16, 0x56, 0x57,
	0x8b, 0x7c, 0x24, 12, 0x0b, 0x7c, 0x24, 16, 0x8d, 0x34, 0x10,
	0x75, 9, 0x85, 0xd2, 0x76, 5, 0x8a, 0x51, 5, 0x30, 0x10, 0x8a, 0x51, 4,
}

// tinyConsumer: an absolute-zero test plus a nonempty read guards field 5; field 4 drives the bulk XOR.
func tinyConsumer(data view, image *pe, xorAt, base int) (int, bool) {
	s := image.sectionAt(xorAt)
	var consumers []int
	for at := max(s.raw, xorAt-24); at+6 <= xorAt; at++ {
		if base == 5 || data[at] != 0xc7 || int(data[at+1]) != base {
			continue
		}
		table, ok := image.fromVA(int(data.u32(at+2)), 8, -1)
		if !ok {
			continue
		}
		consumer, ok := image.fromVA(int(data.u32(table+4)), len(tinyPrefix), 1)
		if !ok || !bytes.Equal(data.sub(consumer, consumer+len(tinyPrefix)), tinyPrefix) {
			continue
		}
		consumerEnd := image.sectionEnd(consumer)
		if data.sub(consumer+len(tinyPrefix), min(consumerEnd, consumer+128)).includes([]byte{0x30, 0x10}) {
			consumers = append(consumers, consumer)
		}
	}
	if len(consumers) != 1 {
		return 0, false
	}
	return consumers[0], true
}

type firstByte struct {
	present      bool
	zeroFallback int
	evidence     map[string]any
}

// firstByteTest locates the guarded first-byte zero replacement after the fold, or returns -1.
func firstByteTest(data view, at, source, base, end int) int {
	if data.at(at+1) != 0x40|source<<3|base || data.at(at+2) != 5 {
		return -1
	}
	at += 3
	if result := registerMove(data, at); result != nil && result.to == 0 && result.from == base {
		at += 2
	}
	if data.at(at) != 0x84 || data.at(at+1) != 0xc0|source<<3|source {
		return -1
	}
	zeroAt := at + 4
	if !guardedZero(data, at+2, zeroAt, base, end) {
		return -1
	}
	return zeroAt
}

// guardedZero is a short JNE over a nonzero MOV BYTE [base+5] replacement.
func guardedZero(data view, at, zeroAt, base, end int) bool {
	next := branch(data, at, end)
	if next == nil || next.op != 0x75 || next.length != 2 || next.target != zeroAt+4 || zeroAt+4 > end {
		return false
	}
	return data.at(zeroAt) == 0xc6 && data.at(zeroAt+1) == 0x40|base && data.at(zeroAt+2) == 5 && data.bit(zeroAt+3) != 0
}

func tinyFirstByte(data view, image *pe, xorAt, source int, value *fold, end int) *firstByte {
	if data.at(value.end) != 0x88 {
		return &firstByte{}
	}
	zeroAt := firstByteTest(data, value.end, source, value.base, end)
	if zeroAt < 0 {
		return nil
	}
	consumer, ok := tinyConsumer(data, image, xorAt, value.base)
	if !ok {
		return nil
	}
	return &firstByte{present: true, zeroFallback: int(data[zeroAt+3]), evidence: map[string]any{
		"firstZeroFallbackVa": vaOf(image, zeroAt), "consumerVa": vaOf(image, consumer),
	}}
}

// TinyProfile is a statically recovered Tiny filter profile.
type TinyProfile struct {
	XORConstant       uint32
	ZeroFallback      int
	FirstByte         bool
	FirstZeroFallback int
	Evidence          map[string]any
}

func (p *TinyProfile) key() string {
	first := "none"
	if p.FirstByte {
		first = fmt.Sprint(p.FirstZeroFallback)
	}
	return fmt.Sprintf("%d:%d:%s", p.XORConstant, p.ZeroFallback, first)
}

// discoverTinyProfiles: tiny folding constructors use one connected SHR/XOR chain and a guarded zero replacement.
func discoverTinyProfiles(input []byte) []*TinyProfile {
	data := moduleBytes(input)
	image := parsePE(data)
	if image == nil {
		return nil
	}
	var profiles []*TinyProfile
	for _, s := range image.executableSections() {
		for at := s.raw; at+12 < s.end; at++ {
			var source, length int
			var constant uint32
			switch {
			case data[at] == 0x81 && data[at+1]&0xf8 == 0xf0:
				source, length, constant = int(data[at+1]&7), 6, data.u32(at+2)
			case data[at] == 0x35:
				source, length, constant = 0, 5, data.u32(at+1)
			default:
				continue
			}
			value := tinyFold(data, at+length, source, s.end)
			if value == nil {
				continue
			}
			first := tinyFirstByte(data, image, at, source, value, s.end)
			if first == nil {
				continue
			}
			evidence := map[string]any{"xorVa": vaOf(image, at), "zeroFallbackVa": vaOf(image, value.zeroAt)}
			for key, item := range first.evidence {
				evidence[key] = item
			}
			profiles = append(profiles, &TinyProfile{
				XORConstant: constant, ZeroFallback: value.zeroFallback,
				FirstByte: first.present, FirstZeroFallback: first.zeroFallback, Evidence: evidence,
			})
		}
	}
	order := []string{}
	byKey := map[string]*TinyProfile{}
	for _, profile := range profiles {
		key := profile.key()
		if _, exists := byKey[key]; !exists {
			order = append(order, key)
		}
		byKey[key] = profile
	}
	result := make([]*TinyProfile, 0, len(order))
	for _, key := range order {
		result = append(result, byKey[key])
	}
	capCandidates(len(result))
	return result
}
