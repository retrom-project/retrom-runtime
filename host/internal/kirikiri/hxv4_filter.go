package kirikiri

import (
	"bytes"
	"encoding/binary"
	"math/bits"
)

// The native flat DripValue VM / bounded generator, cross-checked with xp3-brute 0.3.7 (MIT), hxv4_native.rs.

func splitmix(value uint64) uint64 {
	v := (value ^ value>>30) * 0xbf58476d1ce4e5b9
	v = (v ^ v>>27) * 0x94d049bb133111eb
	return v ^ v>>31
}

func hxRandom(lane uint32, kind int) func() uint32 {
	base := uint64(^lane)<<32 | uint64(lane)
	gamma := uint64(0x9e3779b97f4a7c15)
	a, b := splitmix(base+gamma), splitmix(base+2*gamma)
	return func() uint32 {
		var value uint64
		if kind != 0 {
			value = bits.RotateLeft64(a*5, 7) * 9
		} else {
			value = bits.RotateLeft64(a+b, 17) + a
		}
		b ^= a
		if kind != 0 {
			a = bits.RotateLeft64(a, 24) ^ b ^ b<<16
			b = bits.RotateLeft64(b, 37)
		} else {
			a = bits.RotateLeft64(a, 49) ^ b ^ b<<21
			b = bits.RotateLeft64(b, 28)
		}
		return uint32(value)
	}
}

func legacyRandom(lane uint32) func() uint32 {
	state := lane
	return func() uint32 {
		previous := state
		state = previous*0x41c64e6d + 0x3039
		return state ^ previous<<16 ^ previous>>16
	}
}

type opcode int

const (
	opStop opcode = iota
	opEnter
	opStore
	opNot
	opNeg
	opInc
	opDec
	opShuffle
	opXor
	opAdd
	opSub
	opTable
	opAddScratch
	opSubScratch
	opScratchMinus
	opMul
	opShl
	opShr
	opImmediate
	opSeed
	opTableImmediate
)

var (
	unaryOps  = []opcode{opNot, opNeg, opInc, opDec, opShuffle, opXor, opAdd, opTable}
	binaryOps = []opcode{opAddScratch, opSubScratch, opScratchMinus, opMul, opShl, opShr}
)

type vmInstruction struct {
	op    opcode
	value uint32
}

type generator struct {
	params []byte
	next   func() uint32
	length int
	code   []vmInstruction
}

func (g *generator) add(size int) bool {
	if g.length+size > 128 {
		return false
	}
	g.length += size
	return true
}

func (g *generator) emit(op opcode, value uint32) { g.code = append(g.code, vmInstruction{op, value}) }

func paramIndex(params []byte, value uint32) int { return bytes.IndexByte(params, byte(value)) }

func (g *generator) leaf() bool {
	index := paramIndex(g.params[14:17], g.next()%3)
	if index == 1 {
		if !g.add(2) {
			return false
		}
		g.emit(opSeed, 0)
		return true
	}
	size := 7
	if index == 0 {
		size = 1
	}
	if !g.add(size) {
		return false
	}
	value := g.next()
	if !g.add(4) {
		return false
	}
	if index == 0 {
		g.emit(opImmediate, value)
	} else {
		g.emit(opTableImmediate, value&1023)
	}
	return true
}

func (g *generator) branch(depth int) bool {
	if g.next()&1 != 0 {
		return g.binary(depth)
	}
	return g.unary(depth)
}

var binarySizes = []int{2, 2, 4, 3, 9, 9}

func (g *generator) binary(depth int) bool {
	if depth <= 1 {
		return g.leaf()
	}
	if !g.add(1) {
		return false
	}
	g.emit(opEnter, 0)
	if !g.branch(depth-1) || !g.add(2) {
		return false
	}
	g.emit(opStore, 0)
	if !g.branch(depth - 1) {
		return false
	}
	index := paramIndex(g.params[8:14], g.next()%6)
	if index < 0 || !g.add(binarySizes[index]) || !g.add(1) {
		return false
	}
	g.emit(binaryOps[index], 0)
	g.emit(opStop, 0)
	return true
}

// constant emits ADD or SUB with an immediate operand.
func (g *generator) constant() bool {
	op := opSub
	if g.next()&1 != 0 {
		op = opAdd
	}
	if !g.add(1) {
		return false
	}
	value := g.next()
	if !g.add(4) {
		return false
	}
	g.emit(op, value)
	return true
}

var unarySizes = []int{2, 2, 1, 1, 21, 1, 0, 13}

func (g *generator) unary(depth int) bool {
	if depth <= 1 {
		return g.leaf()
	}
	if !g.branch(depth - 1) {
		return false
	}
	index := paramIndex(g.params[0:8], g.next()&7)
	if index == 6 {
		return g.constant()
	}
	if index < 0 || !g.add(unarySizes[index]) {
		return false
	}
	value := uint32(0)
	if index == 5 {
		value = g.next()
		if !g.add(4) {
			return false
		}
	}
	g.emit(unaryOps[index], value)
	return true
}

func vmLane(params []byte, id uint32, legacy bool) []vmInstruction {
	next := hxRandom(id, int(params[17]>>7))
	if legacy {
		next = legacyRandom(id)
	}
	// Failed attempts retain the PRNG state; only their emitted vector is reset.
	for depth := 5; depth >= 1; depth-- {
		builder := &generator{params: params, next: next}
		if builder.add(9) && builder.binary(depth) && builder.add(6) {
			builder.emit(opStop, 0)
			return builder.code
		}
	}
	panic(fail("HXV4_VM_INVALID"))
}

type vmState struct {
	pc             int
	scratch, value uint32
}

type operand struct {
	r, s, value, input uint32
	table              []uint32
}

// operations is the complete value-producing VM vocabulary; control opcodes are handled by evaluateVM.
var operations = map[opcode]func(*operand) uint32{
	opAdd:            func(o *operand) uint32 { return o.r + o.value },
	opSub:            func(o *operand) uint32 { return o.r - o.value },
	opXor:            func(o *operand) uint32 { return o.r ^ o.value },
	opAddScratch:     func(o *operand) uint32 { return o.r + o.s },
	opSubScratch:     func(o *operand) uint32 { return o.r - o.s },
	opScratchMinus:   func(o *operand) uint32 { return o.s - o.r },
	opMul:            func(o *operand) uint32 { return o.r * o.s },
	opShl:            func(o *operand) uint32 { return o.r << (o.s & 15) },
	opShr:            func(o *operand) uint32 { return o.r >> (o.s & 15) },
	opShuffle:        func(o *operand) uint32 { return (o.r&0x55555555)<<1 | 0x55555555&(o.r>>1) },
	opNot:            func(o *operand) uint32 { return ^o.r },
	opNeg:            func(o *operand) uint32 { return -o.r },
	opInc:            func(o *operand) uint32 { return o.r + 1 },
	opDec:            func(o *operand) uint32 { return o.r - 1 },
	opImmediate:      func(o *operand) uint32 { return o.value },
	opSeed:           func(o *operand) uint32 { return o.input },
	opTableImmediate: func(o *operand) uint32 { return o.table[o.value] },
	opTable:          func(o *operand) uint32 { return o.table[o.r&1023] },
}

func operate(op opcode, state *vmState, value, input uint32, table []uint32) uint32 {
	operation, ok := operations[op]
	if !ok {
		panic(fail("HXV4_VM_INVALID"))
	}
	return operation(&operand{r: state.value, s: state.scratch, value: value, input: input, table: table})
}

// vmStep executes one non-stop instruction and returns the new value and scratch registers.
func vmStep(code []vmInstruction, item vmInstruction, input uint32, table []uint32, state *vmState, depth int,
) (uint32, uint32) {
	if item.op == opEnter {
		scratch := state.scratch
		evaluateVM(code, input, table, state, depth+1)
		return state.value, scratch
	}
	if item.op == opStore {
		return state.value, state.value
	}
	return operate(item.op, state, item.value, input, table), state.scratch
}

func evaluateVM(code []vmInstruction, input uint32, table []uint32, state *vmState, depth int) uint32 {
	require(depth <= 6, "HXV4_VM_INVALID")
	for state.pc < len(code) {
		item := code[state.pc]
		state.pc++
		if item.op == opStop {
			return state.value
		}
		state.value, state.scratch = vmStep(code, item, input, table, state, depth)
	}
	panic(fail("HXV4_VM_INVALID"))
}

// createDripValue builds the 128 lanes; the expression grammar is shared and the PRNG depends on the module format.
func createDripValue(params []byte, table []uint32, legacy bool) func(uint32) uint64 {
	require(validHXParams(params) && len(table) == 1024 && (!legacy || params[17] == 0))
	lanes := make([][]vmInstruction, 128)
	for index := range lanes {
		lanes[index] = vmLane(params, uint32(index), legacy)
	}
	return func(input uint32) uint64 {
		id, seed := input&127, input>>7
		low := evaluateVM(lanes[id], seed, table, &vmState{}, 0)
		high := evaluateVM(lanes[id], ^seed, table, &vmState{}, 0)
		return uint64(low) | uint64(high)<<32
	}
}

type patch [2]int

type boundarySide struct {
	key     byte
	patches [2]patch
}

func dripBoundary(value uint64, fallback byte) boundarySide {
	first, second := int(value>>48), int(value>>32&65535)
	key := byte(value)
	if key == 0 {
		key = fallback
	}
	if first == second {
		second++
	}
	return boundarySide{key: key, patches: [2]patch{{first, int(value >> 8 & 255)}, {second, int(value >> 16 & 255)}}}
}

type hxState struct {
	left, right boundarySide
	split       int64
	prefix      [16]byte
}

type hxManager struct {
	drip   func(uint32) uint64
	params []byte
	nonce0 uint64
}

func createHXManager(material *hxMaterial) *hxManager {
	require(validHXParams(material.params) && len(material.table) == 1024 && len(material.nonce0) == 24 &&
		material.params[17]>>7 <= 1)
	return &hxManager{
		drip: createDripValue(material.params, material.table, false), params: material.params,
		nonce0: binary.LittleEndian.Uint64(material.nonce0),
	}
}

func (m *hxManager) state(entryKey uint64, localFlags int) *hxState {
	key := entryKey
	if localFlags&1 == 0 {
		key ^= m.nonce0
	}
	result := &hxState{left: dripBoundary(m.drip(uint32(key)), 0xa5), right: dripBoundary(m.drip(uint32(key>>32)), 0xa5)}
	result.split = int64(binary.LittleEndian.Uint16(m.params[20:])) +
		int64(binary.LittleEndian.Uint16(m.params[18:])&uint16(key>>16))
	cursor := ^key
	for at := 0; at < 16; at += 8 {
		cursor = ^m.drip(uint32(cursor))
		binary.BigEndian.PutUint64(result.prefix[at:], cursor)
	}
	return result
}

func applyHXState(data []byte, offset int64, state *hxState) {
	require(offset >= 0 && offset <= maxSafe)
	end := offset + int64(len(data))
	middle := max(0, min(int64(len(data)), state.split-offset))
	for index := range data {
		if int64(index) < middle {
			data[index] ^= state.left.key
		} else {
			data[index] ^= state.right.key
		}
	}
	for index := offset; index < min(16, end); index++ {
		data[index-offset] ^= state.prefix[index]
	}
	applyPatches(data, offset, end, state.split, state.left, true)
	applyPatches(data, offset, end, state.split, state.right, false)
}

func applyPatches(data []byte, offset, end, split int64, side boundarySide, left bool) {
	for _, item := range side.patches {
		position := int64(item[0])
		if position >= offset && position < end && (position < split) == left {
			data[position-offset] ^= byte(item[1])
		}
	}
}
