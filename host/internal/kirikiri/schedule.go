package kirikiri

// A bounded static vocabulary for scheduled register operations. This is not an x86 interpreter:
// unsupported instructions stop the def/use relationship.

type move struct{ to, from int }

func registerMove(data view, at int) *move {
	opcode, modrm := data.at(at), data.at(at+1)
	if opcode != 0x8b && opcode != 0x89 || modrm < 0 || modrm>>6 != 3 {
		return nil
	}
	if opcode == 0x8b {
		return &move{to: modrm >> 3 & 7, from: modrm & 7}
	}
	return &move{to: modrm & 7, from: modrm >> 3 & 7}
}

func shiftIs(data view, at, reg, amount int) bool {
	return data.at(at) == 0xc1 && data.at(at+1) == 0xe8|reg && data.at(at+2) == amount
}

func xor32Is(data view, at, to, from int) bool {
	return data.at(at) == 0x33 && data.at(at+1) == 0xc0|to<<3|from || data.at(at) == 0x31 &&
		data.at(at+1) == 0xc0|from<<3|to
}

type modrmInfo struct{ size, mode, rm, reg int }

// memorySize is the operand length after a non-register ModRM byte, or -1 when the SIB byte is outside the bound.
func memorySize(data view, at, end, mode, rm int) int {
	size := 1
	switch {
	case rm == 4:
		if at+size >= end {
			return -1
		}
		if mode == 0 && data.bit(at+size)&7 == 5 {
			size += 4
		}
		size++
	case mode == 0 && rm == 5:
		size += 4
	}
	switch mode {
	case 1:
		size++
	case 2:
		size += 4
	}
	return size
}

func modrm(data view, at, end int) *modrmInfo {
	if at >= end {
		return nil
	}
	value := data.bit(at)
	mode, rm, size := value>>6, value&7, 1
	if mode != 3 {
		if size = memorySize(data, at, end, mode, rm); size < 0 {
			return nil
		}
	}
	if at+size > end {
		return nil
	}
	return &modrmInfo{size: size, mode: mode, rm: rm, reg: value >> 3 & 7}
}

type instruction struct {
	at, size int
	writes   []int
	flow     string
	target   int
}

func (i *instruction) writesRegister(registers ...int) bool {
	for _, write := range i.writes {
		for _, register := range registers {
			if write == register {
				return true
			}
		}
	}
	return false
}

var segmentPrefixes = map[int]bool{0x26: true, 0x2e: true, 0x36: true, 0x3e: true, 0x64: true, 0x65: true}

// simpleInstruction decodes register and immediate forms without a ModRM byte.
func simpleInstruction(op int, result *instruction) bool {
	switch {
	case op >= 0x50 && op <= 0x57:
		result.writes = []int{4}
	case op >= 0x58 && op <= 0x5f:
		result.writes = []int{4, op & 7}
	case op >= 0x40 && op <= 0x4f:
		result.writes = []int{op & 7}
	case op >= 0xb8 && op <= 0xbf:
		result.size, result.writes = 5, []int{op & 7}
	case op >= 0xb0 && op <= 0xb7:
		result.size, result.writes = 2, []int{op & 3}
	case op == 0x90:
	default:
		return immediateInstruction(op, result)
	}
	return true
}

func immediateInstruction(op int, result *instruction) bool {
	switch op {
	case 0x68:
		result.size, result.writes = 5, []int{4}
	case 0x6a:
		result.size, result.writes = 2, []int{4}
	case 0xa0, 0xa1:
		result.size, result.writes = 5, []int{0}
	case 0xa2, 0xa3:
		result.size = 5
	case 0x05, 0x25:
		result.size, result.writes = 5, []int{0}
	case 0xc3:
		result.size, result.flow = 1, "return"
	case 0xc2:
		result.size, result.flow = 3, "return"
	default:
		return false
	}
	return true
}

func isControlFlow(data view, at, op int) bool {
	return op == 0xe8 || op == 0xe9 || op == 0xeb || op >= 0x70 && op <= 0x7f ||
		op == 0x0f && data.at(at+1) >= 0x80 && data.at(at+1) <= 0x8f
}

// step decodes the PE32 instructions used by these relationships with complete operand lengths.
func step(data view, start, end int) *instruction {
	if start < 0 || start >= end {
		return nil
	}
	at := start
	if segmentPrefixes[data.at(at)] {
		at++
	}
	op := data.at(at)
	result := &instruction{at: start, size: 1}
	var decoded bool
	switch {
	case simpleInstruction(op, result):
		decoded = true
	case isControlFlow(data, at, op):
		decoded = controlFlow(data, at, end, op, result)
	default:
		decoded = operandInstruction(data, at, end, op, result)
	}
	if !decoded {
		return nil
	}
	result.size += at - start
	if start+result.size > end {
		return nil
	}
	return result
}

func controlFlow(data view, at, end, op int, result *instruction) bool {
	switch op {
	case 0x0f:
		result.size = 6
	case 0xe8, 0xe9:
		result.size = 5
	default:
		result.size = 2
	}
	if at+result.size > end {
		return false
	}
	if result.size == 2 {
		result.target = at + result.size + data.i8(at+1)
	} else {
		result.target = at + result.size + data.i32(at+result.size-4)
	}
	switch op {
	case 0xe8:
		result.flow = "call"
	case 0xe9, 0xeb:
		result.flow = "jump"
	default:
		result.flow = "branch"
	}
	return true
}

func registerOperand(op int, m *modrmInfo, result *instruction) bool {
	switch op {
	case 0x8b, 0x03, 0x2b, 0x33, 0x8d:
		if op == 0x8d && m.mode == 3 {
			return false
		}
		result.writes = []int{m.reg}
	case 0x89, 0x01, 0x29, 0x31:
		if m.mode == 3 {
			result.writes = []int{m.rm}
		}
	case 0x8a, 0x32:
		result.writes = []int{m.reg & 3}
	case 0x88, 0x30:
		if m.mode == 3 {
			result.writes = []int{m.rm & 3}
		}
	case 0x39, 0x3b, 0x84, 0x85:
	default:
		return false
	}
	return true
}

func immediateOperand(op int, m *modrmInfo, result *instruction) bool {
	switch op {
	case 0x81, 0x83, 0xc1:
		if op == 0x81 {
			result.size += 4
		} else {
			result.size++
		}
		if m.mode == 3 && (op == 0xc1 || m.reg != 7) {
			result.writes = []int{m.rm}
		}
	case 0xc7:
		if m.reg != 0 {
			return false
		}
		result.size += 4
		if m.mode == 3 {
			result.writes = []int{m.rm}
		}
	default:
		return false
	}
	return true
}

func operandInstruction(data view, at, end, op int, result *instruction) bool {
	m := modrm(data, at+1, end)
	if m == nil {
		return false
	}
	result.size += m.size
	return registerOperand(op, m, result) || immediateOperand(op, m, result)
}

func registerPreserved(data view, start, end, reg int) bool {
	if end < start || end-start >= 16 {
		return false
	}
	for at := start; at < end; {
		item := step(data, at, end)
		if item == nil || item.flow != "" || item.writesRegister(reg) {
			return false
		}
		at += item.size
	}
	return true
}

type reachability struct {
	data         view
	start, limit int
	decoded      map[int]*instruction
	order        []int
	occupied     map[int]bool
	pending      []int
}

// claim records an instruction's bytes; overlapping decodings are ambiguous.
func (r *reachability) claim(at int, item *instruction) bool {
	for position := at; position < at+item.size; position++ {
		if r.occupied[position] {
			return false
		}
		r.occupied[position] = true
	}
	r.decoded[at] = item
	r.order = append(r.order, at)
	return true
}

// follow decodes one linear path; it reports false on an ambiguous overlap.
func (r *reachability) follow(at int) bool {
	for at >= r.start && at < r.limit && r.decoded[at] == nil {
		if r.occupied[at] {
			return false
		}
		item := step(r.data, at, r.limit)
		if item == nil {
			return true
		}
		if !r.claim(at, item) {
			return false
		}
		switch item.flow {
		case "return":
			return true
		case "branch":
			r.pending = append(r.pending, item.target)
			at += item.size
		case "jump":
			at = item.target
		default:
			at += item.size
		}
	}
	return true
}

// reachableInstructions follows only local control-flow edges with a fixed byte budget.
func reachableInstructions(data view, start, end int) []*instruction {
	r := &reachability{
		data: data, start: start, limit: min(end, len(data), start+256), pending: []int{start},
		decoded: map[int]*instruction{}, occupied: map[int]bool{},
	}
	for len(r.pending) > 0 {
		at := r.pending[len(r.pending)-1]
		r.pending = r.pending[:len(r.pending)-1]
		if !r.follow(at) {
			return nil
		}
	}
	result := make([]*instruction, len(r.order))
	for index, at := range r.order {
		result[index] = r.decoded[at]
	}
	return result
}

func scheduledOperation(data view, start, end int, matches func(int) bool, preserved ...int) (int, bool) {
	limit := min(end, start+16)
	for at := start; at < limit; {
		item := step(data, at, limit)
		if item == nil {
			return 0, false
		}
		if matches(at) {
			return at, true
		}
		if item.flow != "" || item.writesRegister(preserved...) {
			return 0, false
		}
		at += item.size
	}
	return 0, false
}
