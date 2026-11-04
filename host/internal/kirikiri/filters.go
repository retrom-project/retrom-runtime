package kirikiri

import "encoding/binary"

// Stage is one candidate representation of a protected resource.
type Stage struct {
	ID    string
	Apply func(data []byte, seed uint32, offset int64)
}

// Filter decodes resource bytes in place at absolute uncompressed offsets.
type Filter struct {
	Kind         string
	Verified     bool
	Apply        func(data []byte, seed uint32, offset int64, entry *Entry)
	Stages       []Stage
	Profile      any
	ModuleSHA256 string
}

// Classic Cx's bounded expression grammar. No extracted machine code is executed.
// Operation numbering/reference: xp3-brute 0.3.7 (MIT), src/cxdec_classic.rs.

type cxRandom struct{ value uint32 }

func (r *cxRandom) next() uint32 {
	old := r.value
	r.value = old*0x41c64e6d + 0x3039
	return r.value ^ old<<16 ^ old>>16
}

type expressionKind int

const (
	exprInput expressionKind = iota
	exprLiteral
	exprTable
	exprUnary
	exprBinary
	exprXor
	exprAdd
	exprSub
)

type expression struct {
	kind        expressionKind
	operation   int
	value       uint32
	first, next *expression
}

// builder checks capacity in the native emitter's order: consuming RNG before a failed reserve would change
// all subsequent fallback programs for that lane.
type builder struct {
	profile *classicConfig
	state   *cxRandom
	length  int
}

type classicConfig struct {
	mask, offset uint32
	prolog       []int
	even, odd    []int
	words        []uint32
}

func (b *builder) reserve(length int) bool {
	if b.length+length > 128 {
		return false
	}
	b.length += length
	return true
}

func (b *builder) prolog() *expression {
	switch b.profile.prolog[b.state.next()%3] {
	case 0:
		if !b.reserve(1) {
			return nil
		}
		value := b.state.next()
		if !b.reserve(4) {
			return nil
		}
		return &expression{kind: exprLiteral, value: value}
	case 1:
		if !b.reserve(2) {
			return nil
		}
		return &expression{kind: exprInput}
	case 2:
		if !b.reserve(5) || !b.reserve(2) {
			return nil
		}
		index := b.state.next() & 1023
		if !b.reserve(4) {
			return nil
		}
		return &expression{kind: exprTable, value: index}
	}
	return nil
}

func (b *builder) child(depth int) *expression {
	if b.state.next()&1 != 0 {
		return b.binary(depth)
	}
	return b.unary(depth)
}

var unaryExpressionSizes = []int{2, 1, 2, 1, 13, 21}

func (b *builder) unary(depth int) *expression {
	if depth == 1 {
		return b.prolog()
	}
	inner := b.child(depth - 1)
	if inner == nil {
		return nil
	}
	operation := b.profile.even[b.state.next()&7]
	if operation == 6 || operation == 7 {
		return b.constant(operation, inner)
	}
	if !b.reserve(unaryExpressionSizes[operation]) {
		return nil
	}
	return &expression{kind: exprUnary, operation: operation, first: inner}
}

// constant builds XOR (6) or SUB/ADD (7) with an immediate operand.
func (b *builder) constant(operation int, inner *expression) *expression {
	add := operation == 7 && b.state.next()&1 != 0
	if !b.reserve(1) {
		return nil
	}
	value := b.state.next()
	if !b.reserve(4) {
		return nil
	}
	kind := exprXor
	switch {
	case operation == 7 && add:
		kind = exprAdd
	case operation == 7:
		kind = exprSub
	}
	return &expression{kind: kind, first: inner, value: value}
}

var binaryExpressionSizes = []int{9, 9, 2, 4, 3, 2}

func (b *builder) binary(depth int) *expression {
	if depth == 1 {
		return b.prolog()
	}
	if !b.reserve(1) {
		return nil
	}
	first := b.child(depth - 1)
	if first == nil || !b.reserve(2) {
		return nil
	}
	second := b.child(depth - 1)
	if second == nil {
		return nil
	}
	operation := b.profile.odd[b.state.next()%6]
	if !b.reserve(binaryExpressionSizes[operation]) || !b.reserve(1) {
		return nil
	}
	return &expression{kind: exprBinary, operation: operation, first: first, next: second}
}

func program(profile *classicConfig, lane uint32) *expression {
	state := &cxRandom{value: lane}
	for depth := 5; depth >= 1; depth-- {
		item := &builder{profile: profile, state: state, length: 9}
		if value := item.binary(depth); value != nil && item.reserve(6) {
			return value
		}
	}
	panic(internal("CX_PROFILE: expression exceeds generator capacity"))
}

func unaryOperation(operation int, value uint32, words []uint32) uint32 {
	switch operation {
	case 0:
		return ^value
	case 1:
		return value - 1
	case 2:
		return -value
	case 3:
		return value + 1
	case 4:
		return words[value&1023]
	default:
		return (value&0xaaaaaaaa)>>1 | (value&0x55555555)<<1
	}
}

func binaryOperation(operation int, first, second uint32) uint32 {
	switch operation {
	case 0:
		return second >> (first & 15)
	case 1:
		return second << (first & 15)
	case 2:
		return second + first
	case 3:
		return first - second
	case 4:
		return second * first
	default:
		return second - first
	}
}

func evaluate(value *expression, input uint32, words []uint32) uint32 {
	switch value.kind {
	case exprInput:
		return input
	case exprLiteral:
		return value.value
	case exprTable:
		return words[value.value]
	case exprUnary:
		return unaryOperation(value.operation, evaluate(value.first, input, words), words)
	case exprBinary:
		return binaryOperation(value.operation, evaluate(value.first, input, words), evaluate(value.next, input, words))
	case exprXor:
		return evaluate(value.first, input, words) ^ value.value
	case exprAdd:
		return evaluate(value.first, input, words) + value.value
	case exprSub:
		return evaluate(value.first, input, words) - value.value
	}
	panic(internal("CX_PROFILE: unknown expression"))
}

func permutation(values []int, count int) []int {
	seen := map[int]bool{}
	for _, value := range values {
		if value < 0 || value >= count || seen[value] {
			panic(internal("CX_PROFILE: invalid operation permutation"))
		}
		seen[value] = true
	}
	if len(values) != count {
		panic(internal("CX_PROFILE: invalid operation permutation"))
	}
	return append([]int(nil), values...)
}

// classicFilter is a created classic Cx filter.
type classicFilter struct {
	config   *classicConfig
	programs [128]*expression
}

func createCxFilter(profile *ClassicProfile) *classicFilter {
	if len(profile.ControlBlock) != 4096 {
		panic(internal("CX_PROFILE: expected exactly 4096 control bytes"))
	}
	config := &classicConfig{
		mask: profile.Mask, offset: profile.Offset, prolog: permutation(profile.PrologOrder, 3),
		even: permutation(profile.EvenBranchOrder, 8), odd: permutation(profile.OddBranchOrder, 6),
		words: make([]uint32, 1024),
	}
	for index := range config.words {
		config.words[index] = binary.LittleEndian.Uint32(profile.ControlBlock[index*4:])
	}
	result := &classicFilter{config: config}
	for lane := range result.programs {
		result.programs[lane] = program(config, uint32(lane))
	}
	return result
}

func (f *classicFilter) lane(lane, input uint32) uint32 {
	return evaluate(f.programs[lane], input, f.config.words)
}

func (f *classicFilter) region(data []byte, hash uint32, offset int64, sparse bool) {
	lane, seed := hash&127, hash>>7
	r1, r2 := f.lane(lane, seed), f.lane(lane, ^seed)
	high, low := r2>>16, r2&65535
	if high == low {
		low++
	}
	key := byte(r1)
	if key == 0 {
		key = 1
	}
	for index := range data {
		data[index] ^= key
	}
	if !sparse {
		return
	}
	end := offset + int64(len(data))
	for _, item := range [2][2]uint32{{low, r1 >> 16 & 255}, {high, r1 >> 8 & 255}} {
		if position := int64(item[0]); position >= offset && position < end {
			data[position-offset] ^= byte(item[1])
		}
	}
}

func (f *classicFilter) applyStage(data []byte, hash uint32, offset int64, sparse bool) {
	boundary := int64(hash&f.config.mask + f.config.offset)
	first := 0
	if offset < boundary {
		first = int(min(boundary-offset, int64(len(data))))
	}
	if first > 0 {
		f.region(data[:first], hash, offset, sparse)
	}
	if first < len(data) {
		f.region(data[first:], hash^hash>>16, offset+int64(first), sparse)
	}
}

func (f *classicFilter) apply(data []byte, hash uint32, offset int64) {
	f.applyStage(data, hash, offset, true)
}

func (f *classicFilter) applyBulk(data []byte, hash uint32, offset int64) {
	f.applyStage(data, hash, offset, false)
}

// createTinyFilter folds one resource seed, optionally adding a second XOR at absolute byte zero.
func createTinyFilter(profile *TinyProfile) func([]byte, uint32, int64) {
	if profile.ZeroFallback < 1 || profile.ZeroFallback > 255 || profile.FirstByte &&
		(profile.FirstZeroFallback < 1 || profile.FirstZeroFallback > 255) {
		panic(internal("CX_PROFILE: expected nonzero byte fallback"))
	}
	return func(data []byte, hash uint32, offset int64) {
		t := hash ^ profile.XORConstant
		key := byte(t ^ t>>8 ^ t>>16 ^ t>>24)
		if key == 0 {
			key = byte(profile.ZeroFallback)
		}
		for index := range data {
			data[index] ^= key
		}
		if profile.FirstByte && offset == 0 && len(data) > 0 {
			first := byte(t)
			if first == 0 {
				first = byte(profile.FirstZeroFallback)
			}
			data[0] ^= first
		}
	}
}

// ConfiguredProfile is a bounded configuration recovered from a filter-connected PE.
type ConfiguredProfile struct {
	Params       []byte
	ControlBlock []byte
	LegacyBulk   bool
}

func createConfiguredFilter(profile *ConfiguredProfile) func([]byte, uint32, int64) {
	if !validHXParams(profile.Params) || profile.Params[17] != 0 || len(profile.ControlBlock) != 4096 {
		panic(internal("CX_PROFILE: invalid configured profile"))
	}
	table := make([]uint32, 1024)
	for index := range table {
		table[index] = binary.LittleEndian.Uint32(profile.ControlBlock[index*4:])
	}
	drip := createDripValue(profile.Params, table, true)
	splitBase, splitMask := int64(binary.LittleEndian.Uint16(profile.Params[20:])),
		binary.LittleEndian.Uint16(profile.Params[18:])
	return func(data []byte, seed uint32, offset int64) {
		left, right := dripBoundary(drip(seed), 1), dripBoundary(drip(seed^seed>>16), 1)
		split := splitBase + int64(uint16(seed)&splitMask)
		for index := range data {
			if offset+int64(index) < split {
				data[index] ^= left.key
			} else {
				data[index] ^= right.key
			}
		}
		end := offset + int64(len(data))
		applyPatches(data, offset, end, split, left, true)
		applyPatches(data, offset, end, split, right, false)
	}
}

// RollingProfile is a rolling-table XOR callback recovered from a PE.
type RollingProfile struct {
	Table       []byte
	XORConstant *uint32
}

func createRollingFilter(profile *RollingProfile) func([]byte, uint32, int64) {
	initial := profile.Table
	constant := uint32(0)
	if profile.XORConstant != nil {
		constant = *profile.XORConstant
		if len(initial) < 2 || len(initial) > 128 || len(initial)&(len(initial)-1) != 0 {
			panic(internal("CX_PROFILE: invalid rolling table"))
		}
	} else if len(initial) != 31 {
		panic(internal("CX_PROFILE: invalid rolling table"))
	}
	return func(data []byte, seed uint32, offset int64) {
		value := (seed ^ constant) & 0x7fffffff
		value |= value << 31
		table := append([]byte(nil), initial...)
		for index := range table {
			table[index] ^= byte(value)
			value = (value&0xfffffffe)<<23 | value>>8
		}
		size := int64(len(table))
		for index := range data {
			data[index] ^= table[(offset+int64(index))%size]
		}
	}
}
