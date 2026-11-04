package kirikiri

import (
	"bytes"
	"encoding/hex"
	"fmt"
	"sort"
)

// Static recognition vocabulary cross-checked with xp3-brute 0.3.7 (MIT), src/legacy_cxdec.rs.
// Pattern candidates require independent resource checksum validation by the importer.

func capCandidates(count int) {
	if count > maxCandidates {
		panic(internal("CX_AMBIGUOUS: too many static profile candidates"))
	}
}

func hasU32(data view, value uint32) bool { return bytes.Contains(data, u32bytes(value)) }

func storesRegister(data view, start, end, reg, displacement int) []int {
	var found []int
	for index := start; index+2 < end; index++ {
		m := data.at(index + 1)
		if data.at(index) == 0x89 && m>>6 == 1 && m>>3&7 == reg && m&7 != 4 && data.at(index+2) == displacement {
			found = append(found, m&7)
		}
	}
	return found
}

func intersects(values, others []int) bool {
	for _, value := range values {
		for _, other := range others {
			if value == other {
				return true
			}
		}
	}
	return false
}

type split struct {
	mask, offset       uint32
	separated          bool
	consumer, position int
	delegated          bool
}

func uniqueSplits(values []split) []split {
	order := []string{}
	byKey := map[string]split{}
	for _, value := range values {
		key := fmt.Sprintf("%d:%d", value.mask, value.offset)
		if _, exists := byKey[key]; !exists {
			order = append(order, key)
		}
		byKey[key] = value
	}
	result := make([]split, 0, len(order))
	for _, key := range order {
		result = append(result, byKey[key])
	}
	return result
}

// separatedSplits matches the high-word fold copy whose result is stored beside the boundary.
func separatedSplits(data view, s *section, index, reg, end, add int, before []int) bool {
	var separated []int
	for _, base := range storesRegister(data, add+6, end, reg, 16) {
		if intersects([]int{base}, before) {
			separated = append(separated, base)
		}
	}
	found := false
	for p := max(s.raw, index-24); p+7 <= index; p++ {
		copied := registerMove(data, p)
		if copied != nil && copied.from == reg && shiftIs(data, p+2, copied.to, 16) &&
			xor32Is(data, p+5, copied.to, reg) && intersects(storesRegister(data, add+6, end, copied.to, 8), separated) {
			found = true
		}
	}
	return found
}

func boundaryAdds(data view, s *section, index, reg int, mask uint32, before []int) []split {
	var out []split
	for add := index + 6; add+6 <= min(index+30, s.end); add++ {
		if data.at(add) != 0x81 || data.at(add+1) != 0xc0|reg {
			continue
		}
		offset := data.u32(add + 2)
		if offset == 0 || offset > 0xffffff {
			continue
		}
		end := min(s.end, add+24)
		if intersects(storesRegister(data, add+6, end, reg, 8), before) {
			out = append(out, split{mask: mask, offset: offset, position: index})
		}
		// Each matching copy contributes one candidate; duplicates collapse by mask/offset.
		if separatedSplits(data, s, index, reg, end, add, before) {
			out = append(out, split{mask: mask, offset: offset, position: index, separated: true})
		}
	}
	return out
}

func boundaries(data view, image *pe) []split {
	var out []split
	for _, s := range image.executableSections() {
		for index := s.raw; index+12 < s.end; index++ {
			if data[index] != 0x81 || data[index+1]&0xf8 != 0xe0 {
				continue
			}
			reg, mask := int(data[index+1]&7), data.u32(index+2)
			if mask == 0 || mask > 0xffffff {
				continue
			}
			if before := storesRegister(data, max(s.raw, index-16), index, reg, 4); len(before) > 0 {
				out = append(out, boundaryAdds(data, &s, index, reg, mask, before)...)
			}
		}
	}
	result := uniqueSplits(out)
	capCandidates(len(result))
	return result
}

type callback struct{ start, base int }

// frameLoad matches saved pushes followed by MOV reg, [esp+displacement] of the first argument.
func frameLoad(data view, at, frame int) (callback, bool) {
	load, saved := at, 0
	for saved < 4 && data.at(load) >= 0x50 && data.at(load) <= 0x57 && data.at(load) != 0x54 {
		load++
		saved++
	}
	if data.at(load) == 0x8b && data.bit(load+1)&0xc7 == 0x44 && data.at(load+2) == 0x24 &&
		data.at(load+3) == 4+frame+saved*4 {
		return callback{start: load + 4, base: data.bit(load+1) >> 3 & 7}, true
	}
	return callback{}, false
}

// forwardedTarget follows a guarded forwarding stub to its callee entry.
func forwardedTarget(data view, image *pe, s *section, at int) (int, bool) {
	base := int(data[at+1] & 7)
	guard := branch(data, at+3, s.end)
	if guard == nil || guard.op != 0x74 || guard.target < at+5 || guard.target+6 > min(s.end, at+96) ||
		data.at(guard.target) != 0x50+base {
		return 0, false
	}
	return image.callTarget(guard.target + 1)
}

func forwardedCallbacks(data view, image *pe) []callback {
	var result []callback
	for _, s := range image.executableSections() {
		for at := s.raw; at+5 < s.end; at++ {
			if data[at] != 0x83 || data[at+1]>>3 != 7 || data[at+2] != 24 {
				continue
			}
			target, ok := forwardedTarget(data, image, &s, at)
			if !ok {
				continue
			}
			if found, ok := frameLoad(data, target, 0); ok {
				result = append(result, found)
			}
		}
	}
	capCandidates(len(result))
	return result
}

// stackCallbacks: a standalone cdecl callback may receive the 24-byte record directly.
func stackCallbacks(data view, image *pe) []callback {
	var result []callback
	for _, s := range image.executableSections() {
		for at := s.raw; at+12 < s.end; at++ {
			if data[at] != 0x83 || data[at+1] != 0xec || data[at+2] > 128 {
				continue
			}
			if found, ok := frameLoad(data, at+3, int(data[at+2])); ok {
				result = append(result, found)
			}
		}
	}
	capCandidates(len(result))
	return result
}

type call struct{ at, target int }

// callbackBoundaries tracks the public callback record's seed field, mask/add, high-word fold and region consumer.
func callbackBoundaries(data view, image *pe) []split {
	var out []split
	forwarded, stack := forwardedCallbacks(data, image), stackCallbacks(data, image)
	for _, s := range image.executableSections() {
		for at := s.raw; at+24 < s.end; at++ {
			m := int(data[at+1])
			if data[at] != 0x8b || m>>6 != 1 || m&7 == 4 || data[at+2] != 20 {
				continue
			}
			if found, ok := callbackSplit(data, image, &s, at, m, forwarded, stack); ok {
				out = append(out, found)
			}
		}
	}
	result := uniqueSplits(out)
	capCandidates(len(result))
	return result
}

func callbackABI(data view, s *section, at, base int, forwarded, stack []callback) (bool, bool) {
	abi := false
	for p := max(s.raw, at-64); p+2 < at; p++ {
		if data[p] == 0x83 && int(data[p+1]) == 0x38|base && data[p+2] == 24 {
			abi = true
		}
	}
	delegated, direct := false, false
	for _, value := range forwarded {
		delegated = delegated || value.base == base && registerPreserved(data, value.start, at, base)
	}
	for _, value := range stack {
		direct = direct || value.base == base && registerPreserved(data, value.start, at, base)
	}
	return abi || delegated || direct, delegated
}

type maskAdd struct {
	mask, offset uint32
	start, next  int
}

// seedMaskAdd matches the seed copy followed by the same-register AND mask and ADD offset.
func seedMaskAdd(data view, s *section, at, seed int) (*maskAdd, int, bool) {
	copied, ok := scheduledOperation(data, at+3, s.end, func(p int) bool {
		move := registerMove(data, p)
		return move != nil && move.from == seed
	}, seed)
	if !ok {
		return nil, 0, false
	}
	reg, start := registerMove(data, copied).to, copied+2
	andSize := 0
	switch {
	case data.at(start) == 0x25 && reg == 0:
		andSize = 5
	case data.at(start) == 0x81 && data.at(start+1) == 0xe0|reg:
		andSize = 6
	default:
		return nil, 0, false
	}
	mask := data.u32(start + andSize - 4)
	add, ok := scheduledOperation(data, start+andSize, s.end, func(p int) bool {
		return data.at(p) == 5 && reg == 0 || data.at(p) == 0x81 && data.at(p+1) == 0xc0|reg
	}, seed, reg)
	if !ok {
		return nil, 0, false
	}
	addSize := 6
	if data.at(add) == 5 && reg == 0 {
		addSize = 5
	}
	return &maskAdd{mask: mask, offset: data.u32(add + addSize - 4), start: start, next: add + addSize}, reg, true
}

// foldAt matches a seed copy shifted right by 16 and XORed back into the seed.
func foldAt(data view, p, end, seed int) (int, bool) {
	move := registerMove(data, p)
	if move == nil || move.from != seed {
		return 0, false
	}
	shift, found := scheduledOperation(data, p+2, end, func(q int) bool { return shiftIs(data, q, move.to, 16) },
		seed, move.to)
	if !found {
		return 0, false
	}
	return scheduledOperation(data, shift+3, end, func(q int) bool { return xor32Is(data, q, move.to, seed) },
		seed, move.to)
}

// foldedConsumer finds the first call target that is called again after a fold.
func foldedConsumer(calls []call, folds []int) (int, bool) {
	for _, first := range calls {
		for _, fold := range folds {
			if first.at >= fold {
				continue
			}
			for _, second := range calls {
				if second.at > fold && second.target == first.target {
					return first.target, true
				}
			}
		}
	}
	return 0, false
}

func callbackSplit(data view, image *pe, s *section, at, m int, forwarded, stack []callback) (split, bool) {
	seed, base := m>>3&7, m&7
	linked, delegated := callbackABI(data, s, at, base, forwarded, stack)
	if !linked {
		return split{}, false
	}
	value, _, ok := seedMaskAdd(data, s, at, seed)
	if !ok || value.mask == 0 || value.mask > 0xffffff || value.offset == 0 || value.offset > 0xffffff {
		return split{}, false
	}
	end := min(s.end, at+160)
	var calls []call
	var folds []int
	for p := value.next; p+5 < end; p++ {
		if target, found := image.callTarget(p); found {
			calls = append(calls, call{p, target})
		}
		if fold, found := foldAt(data, p, end, seed); found {
			folds = append(folds, fold)
		}
	}
	consumer, found := foldedConsumer(calls, folds)
	if !found {
		return split{}, false
	}
	return split{mask: value.mask, offset: value.offset, position: value.start, consumer: consumer, delegated: delegated},
		true
}

func indirectCall(data view, at int) bool { return data.at(at) == 0xff && data.bit(at+1)>>3&7 == 2 }

// indirectCallWithin reports an indirect CALL in [from, min(end, limit)).
func indirectCallWithin(data view, from, limit, end int) bool {
	for p := from; p+1 < min(end, limit); p++ {
		if indirectCall(data, p) {
			return true
		}
	}
	return false
}

// negatedSeedCall reports NOT seed followed by PUSH seed and an indirect call.
func negatedSeedCall(data view, from, end, seed int) bool {
	push := 0x50 + seed
	for n := from; n+2 < end; n++ {
		if data.at(n) != 0xf7 || data.at(n+1) != 0xd0+seed {
			continue
		}
		for p := n + 2; p < min(end, n+14); p++ {
			if data.at(p) == push && indirectCallWithin(data, p+1, p+9, end) {
				return true
			}
		}
	}
	return false
}

func seedCalls(data view, start, end, seed int) bool {
	push := 0x50 + seed
	for a := start; a+2 < end; a++ {
		if data.at(a) == push && indirectCallWithin(data, a+1, a+9, end) && negatedSeedCall(data, a+1, end, seed) {
			return true
		}
	}
	return false
}

// spilledSeeds follows only explicit register -> frame slot -> register copies.
func spilledSeeds(data view, shift, end int) []int {
	source := data.bit(shift+1) & 7
	seeds := []int{source}
	for store := shift + 3; store+2 < min(end, shift+12); store++ {
		m := data.at(store + 1)
		if data.at(store) != 0x89 || m>>6 != 1 || m>>3&7 != source || m&7 == 4 {
			continue
		}
		for load := store + 3; load+2 < end; load++ {
			n := data.at(load + 1)
			if data.at(load) == 0x8b && n>>6 == 1 && n&7 == m&7 && data.at(load+2) == data.at(store+2) {
				seeds = append(seeds, n>>3&7)
			}
		}
	}
	return seeds
}

type manager struct {
	at, builder int
	table       int
	hasTable    bool
}

func managers(data view, image *pe) []manager {
	var out []manager
	for _, s := range image.executableSections() {
		code := data[s.raw:s.end]
		if !hasU32(code, 0x41c64e6d) || !hasU32(code, 0x3039) {
			continue
		}
		for a := s.raw; a+3 < s.end; a++ {
			if data[a] != 0x83 || data[a+1]&0xf8 != 0xe0 || data[a+2] != 127 {
				continue
			}
			out = append(out, laneManagers(data, image, &s, a)...)
		}
	}
	order := []string{}
	byKey := map[string]manager{}
	for _, value := range out {
		table := "null"
		if value.hasTable {
			table = fmt.Sprint(value.table)
		}
		key := fmt.Sprintf("%d:%s", value.builder, table)
		if _, exists := byKey[key]; !exists {
			order = append(order, key)
		}
		byKey[key] = value
	}
	result := make([]manager, 0, len(order))
	for _, key := range order {
		result = append(result, byKey[key])
	}
	capCandidates(len(result))
	return result
}

func laneSeeds(data view, s *section, a int) []int {
	seeds := map[int]bool{}
	var order []int
	for p := max(s.raw, a-32); p+2 < min(s.end, a+32); p++ {
		if data[p] != 0xc1 || data[p+1]&0xf8 != 0xe8 || data[p+2] != 7 {
			continue
		}
		for _, seed := range spilledSeeds(data, p, min(s.end, a+0x180)) {
			if !seeds[seed] {
				seeds[seed] = true
				order = append(order, seed)
			}
		}
	}
	return order
}

type laneScan struct {
	data  view
	image *pe
	a     int
	lane  int
	seeds []int
	start int
	end   int
}

func (l *laneScan) anySeed(from int) bool {
	for _, seed := range l.seeds {
		if seedCalls(l.data, from, l.end, seed) {
			return true
		}
	}
	return false
}

// registerBuilders: register-argument legacy builders keep their lane cache in globals.
func (l *laneScan) registerBuilders() []manager {
	var out []manager
	for c := l.a; c+5 < l.end; c++ {
		builder, ok := l.image.callTarget(c)
		argument := registerMove(l.data, c-2)
		if ok && argument != nil && argument.to == 0 && argument.from == l.lane {
			out = append(out, manager{at: l.a, builder: builder})
		}
	}
	return out
}

// tableGetters: a control table is file-backed data even when its PE section is executable.
func (l *laneScan) tableGetters(p, builder int) []manager {
	var out []manager
	for g := max(l.start, p-48); g+5 <= p; g++ {
		getter, found := l.image.callTarget(g)
		if !found || getter+6 > len(l.data) || l.data[getter] != 0xb8 || l.data[getter+5] != 0xc3 {
			continue
		}
		if table, found := l.image.fromVA(int(l.data.u32(getter+1)), 4096, 0); found {
			out = append(out, manager{at: l.a, builder: builder, table: table, hasTable: true})
		}
	}
	return out
}

func (l *laneScan) tableBuilders() []manager {
	var out []manager
	for p := l.start; p+5 < l.end; p++ {
		if l.data[p] != 0x68 || l.data.u32(p+1) != 128 {
			continue
		}
		for c := p + 5; c+5 < min(l.end, p+28); c++ {
			builder, ok := l.image.callTarget(c)
			if ok && l.data.sub(p+5, c).includesByte(0x50+l.lane) && l.anySeed(c+5) {
				out = append(out, l.tableGetters(p, builder)...)
			}
		}
	}
	return out
}

func laneManagers(data view, image *pe, s *section, a int) []manager {
	seeds := laneSeeds(data, s, a)
	if len(seeds) == 0 {
		return nil
	}
	scan := &laneScan{
		data: data, image: image, a: a, lane: int(data[a+1] & 7), seeds: seeds,
		start: max(s.raw, a-48), end: min(s.end, a+0x180),
	}
	var out []manager
	if scan.anySeed(a) {
		out = append(out, scan.registerBuilders()...)
	}
	return append(out, scan.tableBuilders()...)
}

func consumerCallsManager(data view, image *pe, consumer, managerAt int) bool {
	consumerEnd := image.sectionEnd(consumer)
	for _, item := range reachableInstructions(data, consumer, min(consumerEnd, consumer+96)) {
		if item.flow != "call" {
			continue
		}
		target, ok := image.callTarget(item.at)
		if !ok || target > managerAt || managerAt-target > 128 {
			continue
		}
		// Proximity alone does not link a function entry to the manager's lane AND.
		targetEnd := image.sectionEnd(target)
		for _, reached := range reachableInstructions(data, target, min(targetEnd, managerAt+3)) {
			if reached.at == managerAt {
				return true
			}
		}
	}
	return false
}

// ClassicProfile is a statically recovered classic Cx filter profile.
type ClassicProfile struct {
	Mask, Offset    uint32
	PrologOrder     []int
	EvenBranchOrder []int
	OddBranchOrder  []int
	ControlBlock    []byte
	LegacyBulk      bool
	Evidence        map[string]any
}

func (p *ClassicProfile) key() string {
	return fmt.Sprintf("%d:%d:%s:%s:%s:%s", p.Mask, p.Offset, orderKey(p.PrologOrder), orderKey(p.EvenBranchOrder),
		orderKey(p.OddBranchOrder), hex.EncodeToString(p.ControlBlock))
}

func vaOf(image *pe, offset int) any {
	if va, ok := image.toVA(offset); ok {
		return va
	}
	return nil
}

func controlTables(data view, image *pe, targets []int) []int {
	var tables []int
	for _, target := range targets {
		targetEnd := image.sectionEnd(target)
		end := min(targetEnd, target+160)
		for at := target; at+5 <= end; at++ {
			if data[at] < 0xb8 || data[at] > 0xbf {
				continue
			}
			if table, ok := image.fromVA(int(data.u32(at+1)), 4096, 0); ok {
				tables = append(tables, table)
			}
		}
	}
	return uniqueInts(tables)
}

func uniqueInts(values []int) []int {
	order := []int{}
	seen := map[int]bool{}
	for _, value := range values {
		if !seen[value] {
			seen[value] = true
			order = append(order, value)
		}
	}
	return order
}

func nearbyDispatches(image *pe, switches []dispatch, builder int, kind int) []dispatch {
	var result []dispatch
	builderVA, _ := image.toVA(builder)
	for _, item := range switches {
		va, _ := image.toVA(item.at)
		if item.kind == kind && abs(va-builderVA) <= 0x20000 {
			result = append(result, item)
		}
	}
	return result
}

// classicProfiles requires a code-linked manager, file-backed table, constructor and complete grammar permutations.
func classicProfiles(data view, image *pe) []*ClassicProfile {
	managerList := managers(data, image)
	if len(managerList) == 0 {
		return nil
	}
	constructorSplits, callbackSplits, switches := boundaries(data, image), callbackBoundaries(data, image),
		dispatches(data, image)
	var profiles []*ClassicProfile
	for _, m := range managerList {
		for _, p := range nearbyDispatches(image, switches, m.builder, 3) {
			for _, e := range nearbyDispatches(image, switches, m.builder, 8) {
				for _, o := range nearbyDispatches(image, switches, m.builder, 6) {
					found := managerProfiles(data, image, m, grammar{p, e, o}, constructorSplits, callbackSplits)
					profiles = append(profiles, found...)
					capCandidates(len(profiles))
				}
			}
		}
	}
	sort.SliceStable(profiles, func(i, j int) bool { return !profiles[i].LegacyBulk && profiles[j].LegacyBulk })
	return uniqueProfiles(profiles)
}

// legacySplit finds the delegated callback boundary that a separated constructor split replaces, or nil.
func legacySplit(data view, image *pe, m *manager, item *split, callbackSplits []split) *split {
	if !item.separated {
		return nil
	}
	for index := range callbackSplits {
		candidate := &callbackSplits[index]
		if candidate.delegated && candidate.mask == item.mask && candidate.offset == item.offset &&
			consumerCallsManager(data, image, candidate.consumer, m.at) {
			return candidate
		}
	}
	return nil
}

func managerSplits(data view, image *pe, m *manager, constructorSplits, callbackSplits []split) []split {
	if !m.hasTable {
		return callbackSplits
	}
	splits := append([]split(nil), constructorSplits...)
	for _, value := range callbackSplits {
		if consumerCallsManager(data, image, value.consumer, m.at) {
			splits = append(splits, value)
		}
	}
	return splits
}

type grammar struct{ prolog, even, odd dispatch }

func managerProfiles(data view, image *pe, m manager, g grammar, constructorSplits, callbackSplits []split,
) []*ClassicProfile {
	tables := []int{m.table}
	if !m.hasTable {
		tables = controlTables(data, image, g.prolog.targets)
	}
	splits := managerSplits(data, image, &m, constructorSplits, callbackSplits)
	profiles := make([]*ClassicProfile, 0, len(tables)*len(splits))
	for _, table := range tables {
		for index := range splits {
			item := &splits[index]
			legacy := legacySplit(data, image, &m, item, callbackSplits)
			evidence := map[string]any{
				"managerVa": vaOf(image, m.at), "builderVa": vaOf(image, m.builder),
				"tableVa": vaOf(image, table), "boundaryVa": vaOf(image, item.position),
				"dispatchVa": []any{vaOf(image, g.prolog.at), vaOf(image, g.even.at), vaOf(image, g.odd.at)},
			}
			if legacy != nil {
				evidence["legacyBoundaryVa"] = vaOf(image, legacy.position)
			}
			profiles = append(profiles, &ClassicProfile{
				Mask: item.mask, Offset: item.offset, PrologOrder: g.prolog.order,
				EvenBranchOrder: g.even.order, OddBranchOrder: g.odd.order,
				ControlBlock: append([]byte(nil), data.sub(table, table+4096)...), LegacyBulk: legacy != nil, Evidence: evidence,
			})
		}
	}
	return profiles
}

func uniqueProfiles(values []*ClassicProfile) []*ClassicProfile {
	return lastByKey(values, (*ClassicProfile).key)
}

// discoverCxProfiles finds classic profiles in the module and in a statically decoded section image.
func discoverCxProfiles(input []byte) []*ClassicProfile {
	data := moduleBytes(input)
	image := parsePE(data)
	if image == nil {
		return nil
	}
	profiles := classicProfiles(data, image)
	if recovered, evidence := decodePESections(data, image); recovered != nil {
		for _, profile := range classicProfiles(recovered, parsePE(recovered)) {
			copied := *profile
			copied.Evidence = map[string]any{}
			for key, value := range profile.Evidence {
				copied.Evidence[key] = value
			}
			copied.Evidence["sectionDecoder"] = evidence
			profiles = append(profiles, &copied)
		}
	}
	result := uniqueProfiles(profiles)
	capCandidates(len(result))
	return result
}
