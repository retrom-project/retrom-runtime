package kirikiri

import (
	"fmt"
	"strings"
)

// The classic Cx constructor emits its x86 code through a byte-level grammar; these recognizers identify the
// operation permutations from that emitted grammar statically, without executing any module code.

// emittedImmediate decodes one push/mov immediate form; skip is the number of operand bytes consumed.
func emittedImmediate(data view, index int) (int, int, bool) {
	value := data[index]
	switch {
	case value == 0x68 && index+4 < len(data):
		return 4, int(data.u32(index + 1)), true
	case value == 0x6a && index+1 < len(data):
		return 1, int(data[index+1]), true
	case value == 0xc6 && index+2 < len(data) && data[index+1]&0xf8 == 0:
		return 0, int(data[index+2]), true
	case value >= 0xb8 && value <= 0xbf && index+4 < len(data):
		return 4, int(data.u32(index + 1)), true
	case value >= 0xb0 && value <= 0xb7 && index+1 < len(data):
		return 1, int(data[index+1]), true
	}
	return 0, 0, false
}

// branchOperand is the operand length of a branch emitted as part of the grammar, or -1.
func branchOperand(data view, index int) int {
	value := data[index]
	switch {
	case (value == 0xe8 || value == 0xe9) && index+4 < len(data):
		return 4
	case value == 0xeb || value >= 0x70 && value <= 0x7f:
		return 1
	case value == 0x0f && data.at(index+1) >= 0x80 && data.at(index+1) <= 0x8f:
		return 5
	}
	return -1
}

// emittedValues recognizes the emitted grammar, not instructions to be run.
func emittedValues(data view) []int {
	var values []int
	for index := 0; index < len(data); index++ {
		if skip := branchOperand(data, index); skip >= 0 {
			index += skip
			continue
		}
		if skip, value, ok := emittedImmediate(data, index); ok {
			values = append(values, value)
			index += skip
		}
	}
	return values
}

type emitted struct {
	data   view
	values map[int]int
}

func (e *emitted) has(value int) bool    { return e.values[value] > 0 }
func (e *emitted) raw(value uint32) bool { return hasU32(e.data, value) }

func (e *emitted) prolog() (int, bool) {
	switch {
	case e.has(0xbe) && (e.has(0x86) || e.raw(1023)):
		return 2, true
	case e.has(0x8b) && e.has(0xc7):
		return 1, true
	case e.has(0xb8):
		return 0, true
	}
	return 0, false
}

func (e *emitted) even() (int, bool) {
	switch {
	case e.raw(0xaaaaaaaa) && e.raw(0x55555555) || e.values[170] >= 4 && e.values[85] >= 4:
		return 5, true
	case e.raw(1023) && (e.has(0xbe) || e.has(0x86) || e.has(0x25)):
		return 4, true
	case e.has(0x35):
		return 6, true
	case e.has(5) || e.has(0x2d):
		return 7, true
	}
	return e.evenArithmetic()
}

func (e *emitted) evenArithmetic() (int, bool) {
	switch {
	case e.has(0xf7) && e.has(0xd0):
		return 0, true
	case e.has(0xf7) && e.has(0xd8):
		return 2, true
	case e.has(0x48):
		return 1, true
	case e.has(0x40):
		return 3, true
	}
	return 0, false
}

func (e *emitted) odd() (int, bool) {
	switch {
	case e.has(0x0f) && e.has(0xaf) && e.has(0xc3):
		return 4, true
	case e.has(0xf7) && e.has(0xd8) && e.has(1):
		return 3, true
	case e.has(0x29) && e.has(0xd8):
		return 5, true
	case e.has(1) && e.has(0xd8):
		return 2, true
	case e.has(0xd3) && e.has(0xe8):
		return 0, true
	case e.has(0xd3) && e.has(0xe0):
		return 1, true
	}
	return 0, false
}

func classify(data view, kind int, extra []int) (int, bool) {
	values := &emitted{data: data, values: map[int]int{}}
	for _, value := range append(emittedValues(data), extra...) {
		values.values[value]++
	}
	switch kind {
	case 3:
		return values.prolog()
	case 8:
		return values.even()
	default:
		return values.odd()
	}
}

type jump struct{ length, target, op int }

func branch(data view, at, end int) *jump {
	op := data.at(at)
	switch {
	case (op == 0xeb || op >= 0x70 && op <= 0x7f) && at+2 <= end:
		return &jump{2, at + 2 + data.i8(at+1), op}
	case op == 0xe9 && at+5 <= end:
		return &jump{5, at + 5 + data.i32(at+1), op}
	case op == 0x0f && at+6 <= end && data.at(at+1) >= 0x80 && data.at(at+1) <= 0x8f:
		return &jump{6, at + 6 + data.i32(at+2), data.at(at+1) - 0x10}
	}
	return nil
}

var inlineEmitter = []byte{0xc6, 0x00}

// helperValues collects opcode arguments from inline byte-emission helpers called by a branch.
func helperValues(data view, image *pe, target, end int) []int {
	var extra []int
	for at := target; at+5 < end; at++ {
		callee, ok := image.callTarget(at)
		if !ok {
			continue
		}
		calleeEnd := image.sectionEnd(callee)
		helper := data.sub(callee, min(calleeEnd, callee+128))
		// Only inline byte-emission helpers contribute opcode arguments.
		if helper.includes(inlineEmitter) {
			extra = append(extra, emittedValues(helper)...)
		}
	}
	return extra
}

// tailJump is a forward jump into a shared tail outside the primary block, or nil.
func tailJump(data view, at, target, end int) *jump {
	next := branch(data, at, end)
	if next == nil {
		return nil
	}
	// TEST AL,AL / JNE can share a successful tail; JE failure paths never contribute sibling opcodes.
	success := next.op == 0x75 && data.at(at-2) == 0x84 && data.at(at-1) == 0xc0
	if !success && next.op != 0xeb && next.op != 0xe9 || abs(next.target-target) > 0x4000 ||
		next.target >= target && next.target < end {
		return nil
	}
	return next
}

func semantic(data view, image *pe, target, primaryEnd, kind int) (int, bool) {
	s := image.sectionAt(target)
	if s == nil || !s.executable {
		return 0, false
	}
	end := min(s.end, primaryEnd, target+160)
	extra := helperValues(data, image, target, end)
	block := append(view(nil), data.sub(target, end)...)
	if result, ok := classify(block, kind, extra); ok {
		return result, true
	}
	for at, followed := target, 0; at < end && followed < 8; at++ {
		next := tailJump(data, at, target, end)
		if next == nil {
			continue
		}
		jumped := image.sectionAt(next.target)
		if jumped == nil || !jumped.executable {
			continue
		}
		block = append(block, data.sub(next.target, min(jumped.end, next.target+24))...)
		followed++
		if result, ok := classify(block, kind, extra); ok {
			return result, true
		}
		at += next.length - 1
	}
	return 0, false
}

func abs(value int) int {
	if value < 0 {
		return -value
	}
	return value
}

func orderAt(data view, image *pe, targets []int, kind int) []int {
	values := make([]int, len(targets))
	seen := map[int]bool{}
	for index, target := range targets {
		primary := target + 160
		for _, other := range targets {
			if other > target && other < primary {
				primary = other
			}
		}
		value, ok := semantic(data, image, target, primary, kind)
		if !ok {
			return nil
		}
		values[index] = value
		seen[value] = true
	}
	if len(seen) != kind {
		return nil
	}
	return values
}

type dispatch struct {
	at, kind int
	order    []int
	targets  []int
}

func orderKey(values []int) string {
	parts := make([]string, len(values))
	for index, value := range values {
		parts[index] = fmt.Sprint(value)
	}
	return strings.Join(parts, ",")
}

type equalJump struct{ at, length, target int }

// prologDivision is the DIV by the loaded constant 3 following at, or -1.
func prologDivision(data view, at, end int) int {
	for d := at + 5; d+1 < min(end, at+64); d++ {
		if data[d] == 0xf7 && int(data[d+1]) == 0xf0|int(data[at]-0xb8) {
			return d
		}
	}
	return -1
}

// prologTargets recovers the two JE targets and the JNE fallthrough of a remainder dispatch, or nil.
func prologTargets(data view, division, sectionEnd int) []int {
	var equal []equalJump
	end := min(sectionEnd, division+80)
	for p := division + 2; p < end && len(equal) < 2; p++ {
		if next := branch(data, p, end); next != nil && next.op == 0x74 {
			equal = append(equal, equalJump{p, next.length, next.target})
			p += next.length - 1
		}
	}
	if len(equal) != 2 {
		return nil
	}
	for p := equal[1].at + equal[1].length; p < min(end, equal[1].at+25); p++ {
		if next := branch(data, p, end); next != nil && next.op == 0x75 {
			return []int{equal[0].target, equal[1].target, p + next.length}
		}
	}
	return nil
}

func branchPrologs(data view, image *pe, s *section) []dispatch {
	var out []dispatch
	for at := s.raw; at+32 < s.end; at++ {
		if data[at] < 0xb8 || data[at] > 0xbf || data.u32(at+1) != 3 {
			continue
		}
		division := prologDivision(data, at, s.end)
		if division < 0 {
			continue
		}
		targets := prologTargets(data, division, s.end)
		if targets == nil {
			continue
		}
		if order := orderAt(data, image, targets, 3); order != nil {
			out = append(out, dispatch{at: at, kind: 3, order: order, targets: targets})
		}
	}
	return out
}

// tableTargets reads a kind-entry jump table referenced at at, or nil.
func tableTargets(data view, image *pe, at, kind int) []int {
	table, ok := image.fromVA(int(data.u32(at+3)), kind*4, 0)
	if !ok {
		return nil
	}
	targets := make([]int, kind)
	valid := true
	for index := range kind {
		target, found := image.fromVA(int(data.u32(table+index*4)), 1, 1)
		targets[index], valid = target, valid && found
	}
	if !valid {
		return nil
	}
	return targets
}

func tableDispatches(data view, image *pe, s *section) []dispatch {
	var out []dispatch
	for at := s.raw; at+7 < s.end; at++ {
		sib := int(data[at+2])
		if data[at] != 0xff || data[at+1] != 0x24 || sib>>6 != 2 || sib&7 != 5 || sib>>3&7 == 4 {
			continue
		}
		for _, kind := range []int{3, 8, 6} {
			targets := tableTargets(data, image, at, kind)
			if targets == nil {
				continue
			}
			if order := orderAt(data, image, targets, kind); order != nil {
				out = append(out, dispatch{at: at, kind: kind, order: order, targets: targets})
			}
		}
	}
	return out
}

// lastByKey keeps each key at its first position with its last value, like a JavaScript Map.
func lastByKey[T any](values []T, key func(T) string) []T {
	order := []string{}
	byKey := map[string]T{}
	for _, value := range values {
		name := key(value)
		if _, exists := byKey[name]; !exists {
			order = append(order, name)
		}
		byKey[name] = value
	}
	result := make([]T, 0, len(order))
	for _, name := range order {
		result = append(result, byKey[name])
	}
	return result
}

func dispatches(data view, image *pe) []dispatch {
	sections := image.executableSections()
	out := make([]dispatch, 0, len(sections))
	for _, s := range sections {
		out = append(out, branchPrologs(data, image, &s)...)
		out = append(out, tableDispatches(data, image, &s)...)
	}
	result := lastByKey(out, func(value dispatch) string {
		return fmt.Sprintf("%d:%s", value.kind, orderKey(value.order))
	})
	capCandidates(len(result))
	return result
}
