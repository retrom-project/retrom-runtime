package kirikiri

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"regexp"
)

var (
	paramsMarker  = []byte("--data--PARAMS\x00")
	filterSetter  = "void ::TVPSetXP3ArchiveExtractionFilter(tTVPXP3ArchiveExtractionFilter)"
	lcgMultiplier = []byte{0x6d, 0x4e, 0xc6, 0x41}
	lcgIncrement  = []byte{0x39, 0x30, 0, 0}
	recordName    = regexp.MustCompile(`^[A-Z][A-Z0-9_]*$`)
)

func configRecords(data view, item *section, start int) map[string][]byte {
	found := map[string][]byte{}
	at := start + 8
	for count := 0; count < 32 && at < item.end; count++ {
		end := data.indexOf([]byte{0}, at)
		if end < at || end >= item.end || end-at > 64 {
			return nil
		}
		if end == at {
			return found
		}
		if end+3 > item.end {
			return nil
		}
		name, size, begin := data.ascii(at, end), data.u16(end+1), end+3
		if _, exists := found[name]; !recordName.MatchString(name) || exists || begin+size > item.end {
			return nil
		}
		found[name] = data[begin : begin+size]
		at = begin + size
	}
	return nil
}

func pushedString(data view, image *pe, at int, value string) bool {
	if data.at(at) != 0x68 {
		return false
	}
	target, ok := image.fromVA(int(data.u32(at+1)), len(value)+1, -1)
	return ok && data.ascii(target, target+len(value)+1) == value+"\x00"
}

func nearbyCall(image *pe, at, end int) (int, bool) {
	for p := at + 5; p+5 <= min(at+24, end); p++ {
		if target, ok := image.callTarget(p); ok {
			return target, true
		}
	}
	return 0, false
}

func isFilterCallback(data view, image *pe, va int) bool {
	start, ok := image.fromVA(va, 1, 1)
	if !ok {
		return false
	}
	sectionEnd := image.sectionEnd(start)
	end := min(start+160, sectionEnd)
	for p := start; p+3 <= end; p++ {
		if data[p] != 0x83 || data[p+1]&0xf8 != 0x38 || data[p+2] != 24 {
			continue
		}
		base := int(data[p+1] & 7)
		for q := p + 3; q+3 <= min(end, p+48); q++ {
			if data[q] == 0xff && int(data[q+1]) == 0x70|base && data[q+2] == 20 {
				return true
			}
		}
	}
	return false
}

func hasConfiguredLoader(data view, image *pe, configVA int) bool {
	address := u32bytes(uint32(configVA + 8))
	for _, item := range image.executableSections() {
		for p := item.raw; p+5 < item.end; p++ {
			if !pushedString(data, image, p, "PARAMS") {
				continue
			}
			parser, ok := nearbyCall(image, p, item.end)
			if !ok {
				continue
			}
			parserEnd := image.sectionEnd(parser)
			if !data.sub(parser, min(parser+128, parserEnd)).includes(address) {
				continue
			}
			if loaderChain(data, image, &item, p, parser) {
				return true
			}
		}
	}
	return false
}

func loaderChain(data view, image *pe, item *section, p, parser int) bool {
	for q := p + 5; q+5 < min(p+256, item.end); q++ {
		if !pushedString(data, image, q, "TABLE") {
			continue
		}
		if target, ok := nearbyCall(image, q, item.end); !ok || target != parser {
			continue
		}
		for r := q + 5; r+5 < min(p+512, item.end); r++ {
			if !pushedString(data, image, r, filterSetter) {
				continue
			}
			for s := r + 5; s+5 < min(r+80, item.end); s++ {
				if data[s] == 0x68 && isFilterCallback(data, image, int(data.u32(s+1))) {
					return true
				}
			}
		}
	}
	return false
}

func hasLegacyRandom(data view, image *pe) bool {
	for _, item := range image.executableSections() {
		first := data.indexOf(lcgMultiplier, item.raw)
		if first >= item.raw && first+4 < item.end && data.sub(first+4, min(first+64, item.end)).includes(lcgIncrement) {
			return true
		}
	}
	return false
}

// configuredAt validates one PARAMS/TABLE record pair connected to the configured loader, or nil.
func configuredAt(data view, image *pe, item *section, start int) *ConfiguredProfile {
	records := configRecords(data, item, start)
	params, control := records["PARAMS"], records["TABLE"]
	va, _ := image.toVA(start)
	if params == nil || control == nil || !validHXParams(params) || params[17] != 0 || len(control) != 4096 ||
		!hasConfiguredLoader(data, image, va) {
		return nil
	}
	return &ConfiguredProfile{Params: append([]byte(nil), params...), ControlBlock: append([]byte(nil), control...)}
}

func (p *ConfiguredProfile) key() string {
	hash := sha256.New()
	hash.Write(p.Params)
	hash.Write(p.ControlBlock)
	return hex.EncodeToString(hash.Sum(nil))
}

// discoverConfiguredProfiles recovers bounded configuration only from a PE connected to the filter callback.
func discoverConfiguredProfiles(input []byte) []*ConfiguredProfile {
	if len(input) > maxModuleBytes {
		return nil
	}
	data := view(input)
	image := parsePE(data)
	if image == nil || !hasLegacyRandom(data, image) {
		return nil
	}
	var profiles []*ConfiguredProfile
	distinct := map[string]bool{}
	for _, item := range image.dataSections() {
		for at := item.raw; at < item.end; {
			start := data.indexOf(paramsMarker, at)
			if start < 0 || start+len(paramsMarker) > item.end {
				break
			}
			at = start + len(paramsMarker)
			profile := configuredAt(data, image, &item, start)
			if profile == nil {
				continue
			}
			profiles = append(profiles, profile)
			distinct[profile.key()] = true
			if len(distinct) > 32 {
				panic(internal("CX_AMBIGUOUS: too many configured profiles"))
			}
		}
	}
	return lastByKey(profiles, (*ConfiguredProfile).key)
}

var (
	rollingHeader   = []byte{0x55, 0x8b, 0xec, 0x83, 0xec, 0x24}
	rollingABI      = []byte{0x8b, 0x7d, 0x08, 0x83, 0x3f, 0x18}
	rollingSeed     = []byte{0x8b, 0x4f, 0x14, 0x81, 0xe1, 0xff, 0xff, 0xff, 0x7f}
	rollingRotation = []byte{
		0x30, 0x4c, 0x15, 0xdc, 0x8b, 0xc1, 0x83, 0xe0, 0xfe, 0xc1, 0xe9, 8, 0xc1, 0xe0,
		0x17, 0x42, 0x0b, 0xc8, 0x83, 0xfa, 0x1f, 0x7c, 0xe9,
	}
	rollingConsumer = []byte{
		0x8b, 0x77, 0x0c, 0x33, 0xc0, 0x8b, 0xcb, 0x03, 0x4f, 4, 0x6a, 0, 0x13, 0x47, 8,
		0x6a, 0x1f, 0x50, 0x51, 0xe8,
	}
	rollingTail       = []byte{0x8a, 0x44, 0x05, 0xdc, 0x30, 0x04, 0x1e, 0x43, 0x3b, 0x5f, 0x10, 0x72, 0xdb}
	rollingStreamType = []byte(".?AVtTVPXP3ArchiveStream@@\x00")
)

func within(data view, pattern []byte, start, end int) int {
	at := data.indexOf(pattern, start)
	if at >= start && at+len(pattern) <= end {
		return at
	}
	return -1
}

// rollingAnchors locates the seed and rotation of a rolling callback, or reports false.
func rollingAnchors(data view, image *pe, start, end int) (int, int, bool) {
	if !bytes.Equal(data.sub(start, start+len(rollingHeader)), rollingHeader) || within(data, rollingABI, start,
		min(start+32, end)) < 0 {
		return 0, 0, false
	}
	seedAt := within(data, rollingSeed, start, min(start+96, end))
	if seedAt < 0 {
		return 0, 0, false
	}
	rotateAt := within(data, rollingRotation, seedAt+len(rollingSeed), end)
	if rotateAt < 0 {
		return 0, 0, false
	}
	consumerAt := within(data, rollingConsumer, rotateAt+len(rollingRotation), end)
	if consumerAt < 0 {
		return 0, 0, false
	}
	if _, ok := image.callTarget(consumerAt + len(rollingConsumer) - 1); !ok {
		return 0, 0, false
	}
	tailAt := consumerAt + len(rollingConsumer) + 4
	if !bytes.Equal(data.sub(tailAt, tailAt+len(rollingTail)), rollingTail) {
		return 0, 0, false
	}
	return seedAt, rotateAt, true
}

var rollingFolds = map[int][]byte{0: {0x8b, 0xc1}, 1: {0xc1, 0xe0, 0x1f, 0x0b, 0xc8}}

// rollingWords copies the seven stored table dwords; it returns the end position or -1.
func rollingWords(data view, table []byte, at, rotateAt int) int {
	for index := range 7 {
		found := within(data, []byte{0xc7, 0x45, byte(0xdc + index*4)}, at, rotateAt)
		if found < 0 || found+7 > rotateAt {
			return -1
		}
		copy(table[index*4:], data[found+3:found+7])
		at = found + 7
		if fold, exists := rollingFolds[index]; exists && !bytes.Equal(data.sub(at, at+len(fold)), fold) {
			return -1
		}
	}
	return at
}

func callbackTable(data view, image *pe, address int) []byte {
	start, ok := image.fromVA(address, 1, 1)
	if !ok {
		return nil
	}
	sectionEnd := image.sectionEnd(start)
	end := min(start+512, sectionEnd)
	seedAt, rotateAt, ok := rollingAnchors(data, image, start, end)
	if !ok {
		return nil
	}
	table := make([]byte, 31)
	at := rollingWords(data, table, seedAt+len(rollingSeed), rotateAt)
	if at < 0 {
		return nil
	}
	word := within(data, []byte{0x66, 0xc7, 0x45, 0xf8}, at, rotateAt)
	byteAt := -1
	if word >= 0 {
		byteAt = within(data, []byte{0xc6, 0x45, 0xfa}, word+6, rotateAt)
	}
	if word < 0 || word+6 > rotateAt || byteAt < 0 || byteAt+4 > rotateAt {
		return nil
	}
	copy(table[28:], data[word+4:word+6])
	table[30] = data[byteAt+3]
	return table
}

func dataReferences(data view, image *pe, address int) []int {
	value := u32bytes(uint32(address))
	var found []int
	for _, item := range image.dataSections() {
		for at := data.indexOf(value, item.raw); at >= item.raw && at+4 <= item.end; at = data.indexOf(value, at+1) {
			if (at-item.raw)%4 == 0 {
				found = append(found, at)
			}
			if len(found) > 32 {
				panic(internal("CX_AMBIGUOUS: too many rolling references"))
			}
		}
	}
	return found
}

var (
	inlineSource = []byte{0x8b, 0x46, 8, 0x8d, 0x0c, 0x80, 0x8b, 0x46, 4, 0x8b, 0x80}
	inlineFold   = []int{
		0x8b, 0x4c, 0xc8, 4, 0x8b, 0x46, 0x30, 0x81, 0xf1, wild, wild, wild, wild, 0x81, 0xe1, 0xff, 0xff, 0xff,
		0x7f, 0x89, 0x45, wild, 0x8b, 0xc1, 0xc1, 0xe0, 0x1f, 0x0b, 0xc8, 0x33, 0xd2,
	}
	inlineLoop = []int{
		0x8b, 0xc1, 0x88, 0x4c, 0x15, wild, 0x83, 0xe0, 0xfe, 0xc1, 0xe9, 8, 0xc1, 0xe0, 0x17, 0x42, 0x0b,
		0xc8, 0x83, 0xfa, wild, 0x7e, wild,
	}
)

func inlineProfile(data view, image *pe, address int) *RollingProfile {
	start, ok := image.fromVA(address, 3, 1)
	if !ok {
		return nil
	}
	sectionEnd := image.sectionEnd(start)
	end := min(start+4096, sectionEnd)
	if !matches(data, start, []int{0x55, 0x8b, 0xec}, end) {
		return nil
	}
	// The archive-entry seed and absolute stream position feed both loops.
	at := within(data, inlineSource, start+3, min(start+1024, end))
	if at < 0 || !matches(data, at+15, inlineFold, end) {
		return nil
	}
	loop := at + 46
	if matches(data, loop, []int{0x0f, 0x1f, 0}, end) {
		loop += 3
	}
	position := data.at(at + 36)
	if !matches(data, loop, inlineLoop, end) || loop+23+data.i8(loop+22) != loop {
		return nil
	}
	mask, table := data.at(loop+20), data.at(loop+5)
	length, consume := mask+1, loop+23
	if length < 2 || length > 128 || length&mask != 0 || !matches(data, consume, []int{
		0x85, 0xdb, 0x7e, 0x1f, 0x8b, 0x75, position,
		0x8b, 0xcb, 0x2b, 0xf7, 0x8d, 4, 0x3e, 0x83, 0xe0, mask, 0x8d, 0x7f, 1, 0x8a, 0x44, 5, table,
		0x30, 0x47, 0xff, 0x83, 0xe9, 1, 0x75, wild,
	}, end) || consume+32+data.i8(consume+31) != consume+11 {
		return nil
	}
	constant := data.u32(at + 24)
	return &RollingProfile{Table: make([]byte, length), XORConstant: &constant}
}

func inlineProfiles(data view, image *pe) []*RollingProfile {
	var found []*RollingProfile
	for _, item := range image.dataSections() {
		for at := data.indexOf(rollingStreamType, item.raw); at >= item.raw+8 &&
			at+len(rollingStreamType) <= item.end; at = data.indexOf(rollingStreamType, at+1) {
			// MSVC RTTI links the exact stream type to its vtable, whose second entry implements Read.
			typeVA, _ := image.toVA(at - 8)
			for _, typeRef := range dataReferences(data, image, typeVA) {
				found = append(found, vtableProfiles(data, image, typeRef)...)
				if len(found) > 32 {
					panic(internal("CX_AMBIGUOUS: too many rolling profiles"))
				}
			}
		}
	}
	return found
}

func vtableProfiles(data view, image *pe, typeRef int) []*RollingProfile {
	locator := typeRef - 12
	referenced := image.sectionAt(typeRef)
	if locator < referenced.raw || !bytes.Equal(data.sub(locator, locator+12), make([]byte, 12)) ||
		locator+20 > referenced.end {
		return nil
	}
	if _, ok := image.fromVA(int(data.u32(locator+16)), 16, -1); !ok {
		return nil
	}
	locatorVA, _ := image.toVA(locator)
	var found []*RollingProfile
	for _, vtableRef := range dataReferences(data, image, locatorVA) {
		if vtableRef+28 > image.sectionAt(vtableRef).end {
			continue
		}
		valid := true
		for index := range 6 {
			_, ok := image.fromVA(int(data.u32(vtableRef+4+4*index)), 1, 1)
			valid = valid && ok
		}
		if !valid {
			continue
		}
		if profile := inlineProfile(data, image, int(data.u32(vtableRef+8))); profile != nil {
			found = append(found, profile)
		}
		if len(found) > 32 {
			panic(internal("CX_AMBIGUOUS: too many rolling profiles"))
		}
	}
	return found
}

// discoverRollingProfiles recovers a connected rolling-table callback without executing it.
func discoverRollingProfiles(input []byte) []*RollingProfile {
	if len(input) > maxModuleBytes {
		return nil
	}
	data := view(input)
	image := parsePE(data)
	if image == nil {
		return nil
	}
	order := []string{}
	found := map[string]*RollingProfile{}
	add := func(key string, profile *RollingProfile) {
		if _, exists := found[key]; !exists {
			order = append(order, key)
		}
		found[key] = profile
	}
	for _, profile := range inlineProfiles(data, image) {
		add(rollingKey(profile), profile)
	}
	for _, item := range image.executableSections() {
		for at := item.raw; at+5 < item.end; at++ {
			if data[at] != 0x68 || !pushedString(data, image, at, filterSetter) {
				continue
			}
			for p := at + 5; p+7 <= min(at+96, item.end); p++ {
				if data[p] != 0x68 || data[p+5] != 0xff || data[p+6] != 0xd0 {
					continue
				}
				if table := callbackTable(data, image, int(data.u32(p+1))); table != nil {
					add(hex.EncodeToString(table), &RollingProfile{Table: table})
				}
			}
		}
	}
	result := make([]*RollingProfile, 0, len(order))
	for _, key := range order {
		result = append(result, found[key])
	}
	return result
}

func rollingKey(profile *RollingProfile) string {
	constant := "undefined"
	if profile.XORConstant != nil {
		constant = hex.EncodeToString(u32bytes(*profile.XORConstant))
	}
	return constant + ":" + hex.EncodeToString(profile.Table)
}
