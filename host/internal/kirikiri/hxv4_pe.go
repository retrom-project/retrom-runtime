package kirikiri

import (
	"bytes"
	"encoding/hex"
	"fmt"
	"regexp"
	"sort"

	"github.com/retrom-project/retrom-runtime/host/internal/textcodec"
)

func strictUTF16(data []byte) (string, bool) { return textcodec.Decode(data, "utf-16le", true) }

func mustUTF16(data []byte) string {
	text, ok := strictUTF16(data)
	if !ok {
		panic(internal("The encoded data was not valid for encoding utf-16le"))
	}
	return text
}

type resourceWalker struct {
	data    view
	image   *pe
	base    int
	length  int
	result  map[string][]byte
	visited map[int]bool
	count   int
}

func (w *resourceWalker) at(offset, size int) int {
	require(offset >= 0 && offset+size <= w.length)
	return w.base + offset
}

func (w *resourceWalker) walk(offset int, path []string) {
	require(len(path) <= 3 && !w.visited[offset])
	w.visited[offset] = true
	start := w.at(offset, 16)
	size := w.data.u16(start+12) + w.data.u16(start+14)
	require(size <= 4096 && w.count+size <= 8192, "MODULE_LIMIT")
	w.count += size
	w.at(offset+16, size*8)
	for index := range size {
		p := start + 16 + index*8
		name, next := w.data.u32(p), w.data.u32(p+4)
		key := fmt.Sprint(name)
		if name&0x80000000 != 0 {
			n := int(name & 0x7fffffff)
			units := w.data.u16(w.at(n, 2))
			begin := w.at(n+2, units*2)
			key = mustUTF16(w.data[begin : begin+units*2])
		}
		if next&0x80000000 != 0 {
			w.walk(int(next&0x7fffffff), append(append([]string(nil), path...), key))
			continue
		}
		require(len(path) == 2)
		entry := w.at(int(next), 16)
		rva, sizeBytes := int(w.data.u32(entry)), int(w.data.u32(entry+4))
		begin, ok := w.image.fromVA(w.image.imageBase+rva, sizeBytes, 0)
		require(ok && sizeBytes <= maximumIndex)
		id := path[0] + "/" + path[1]
		if id == "10/STARTUP.TJS" || id == "10/BOOTSTRAP" || id == "TEXT/127" {
			value := w.data[begin : begin+sizeBytes]
			existing, exists := w.result[id]
			require(!exists || bytes.Equal(existing, value))
			w.result[id] = value
		}
	}
}

func peResources(data view, image *pe) map[string][]byte {
	address := int(data.u32(60))
	header := address + 24
	if data.u16(address+20) < 120 {
		return map[string][]byte{}
	}
	length, rva := int(data.u32(header+116)), int(data.u32(header+112))
	if rva == 0 || length == 0 {
		return map[string][]byte{}
	}
	base, ok := image.fromVA(image.imageBase+rva, length, 0)
	require(ok && length <= maximumIndex)
	walker := &resourceWalker{
		data: data, image: image, base: base, length: length, result: map[string][]byte{},
		visited: map[int]bool{},
	}
	walker.walk(0, nil)
	return walker.result
}

var tjsSignature = []byte("TJS2100\x00")

// hxTJSStrings reads only the typed DATA string pool; no TJS execution or decompilation.
func hxTJSStrings(data view) []string {
	require(len(data) >= 12 && bytes.Equal(data[:8], tjsSignature) && int(data.u32(8)) == len(data))
	for at := 12; at+8 <= len(data); {
		size := int(data.u32(at + 4))
		require(size >= 8 && at+size <= len(data))
		if data.ascii(at, at+4) != "DATA" {
			at += size
			continue
		}
		end, p := at+size, at+8
		read32 := func() int {
			require(p+4 <= end)
			value := int(data.u32(p))
			p += 4
			return value
		}
		take := func(count int) []byte {
			require(count <= end-p)
			result := data[p : p+count]
			p += (count + 3) / 4 * 4
			require(p <= end)
			return result
		}
		for _, unit := range []int{1, 2, 4, 8, 8} {
			take(read32() * unit)
		}
		count := read32()
		require(count <= 100000, "MODULE_LIMIT")
		result := make([]string, 0, count)
		for range count {
			n := read32()
			require(n <= 32767)
			result = append(result, mustUTF16(take(n*2)))
		}
		return result
	}
	panic(fail("HXV4_BOOTSTRAP_UNAVAILABLE"))
}

var bresPattern = regexp.MustCompile(`(?i)^bres://\./([a-z\d]+)(?:/[a-z\d._-]+)*/?$`)

func bresPath(url string) string {
	match := bresPattern.FindStringSubmatch(url)
	require(match != nil && len(match[1]) <= 256)
	return match[1]
}

func hxSalts(data view, image *pe) [][]byte {
	order := []int{}
	values := map[int][]byte{}
	for _, item := range image.executableSections() {
		for at := item.raw; at+20 <= item.end; at++ {
			if data[at] != 0xc7 || data[at+1] != 5 {
				continue
			}
			salt, ok := image.fromVA(int(data.u32(at+6)), 8192, 0)
			if !ok {
				continue
			}
			for p := at + 10; p+10 <= min(item.end, at+64); p++ {
				if data[p] == 0xc7 && data[p+1] == 5 && data.u32(p+6) == 8192 {
					if _, exists := values[salt]; !exists {
						order = append(order, salt)
					}
					values[salt] = data[salt : salt+8192]
					break
				}
			}
			require(len(values) <= 32, "MODULE_LIMIT")
		}
	}
	result := make([][]byte, 0, len(order))
	for _, salt := range order {
		result = append(result, values[salt])
	}
	return result
}

func hxConfig(data view, tag string, valid func([]byte) bool) []byte {
	marker := append([]byte(tag), 0)
	order := []string{}
	found := map[string][]byte{}
	cursor := 0
	for range 64 {
		at := data.indexOf(marker, cursor)
		if at < 0 {
			break
		}
		cursor = at + 1
		p := at + len(marker)
		if p+2 > len(data) {
			continue
		}
		size := data.u16(p)
		if size > 32767 || p+2+size > len(data) {
			continue
		}
		value := data[p+2 : p+2+size]
		if valid(value) {
			key := hex.EncodeToString(value)
			if _, exists := found[key]; !exists {
				order = append(order, key)
			}
			found[key] = value
		}
	}
	require(len(found) == 1, "HXV4_BOOTSTRAP_UNAVAILABLE")
	return found[order[0]]
}

var (
	xoptMarker = append(utf16le("--xopt--no\x00"), 0, 0)
	seedGuard  = []byte{0x0f, 0x45, 0xf0}
)

func markerSeeds(data view) [][]byte {
	var seeds [][]byte
	for cursor := 0; cursor < len(data); {
		at := data.indexOf(xoptMarker, cursor)
		if at < 0 {
			break
		}
		seeds = append(seeds, data.sub(at+len(xoptMarker), at+len(xoptMarker)+8))
		cursor = at + len(xoptMarker)
	}
	return seeds
}

func codeSeeds(data view, image *pe) [][]byte {
	var seeds [][]byte
	for _, item := range image.executableSections() {
		for p := item.raw; p+80 <= item.end; p++ {
			if data[p] != 0xc7 || data[p+1] != 0x45 || data[p+7] != 0xc7 || data[p+8] != 0x45 ||
				data[p+9] != data[p+2]+4 || !bytes.Equal(data[p+14:p+17], seedGuard) {
				continue
			}
			tail := data[p+17 : p+80]
			if tail.includes([]byte{0xff, 0x36}) && tail.includes([]byte{0x6a, 8}) && tail.includesByte(0x56) &&
				tail.includesByte(0xe8) {
				seeds = append(seeds, append(append([]byte(nil), data[p+3:p+7]...), data[p+10:p+14]...))
			}
		}
	}
	return seeds
}

func hxSeeds(data view, image *pe) [][]byte {
	var candidates [][]byte
	for _, value := range append(markerSeeds(data), codeSeeds(data, image)...) {
		if len(value) == 8 && bytes.Count(value, []byte{0}) != 8 {
			candidates = append(candidates, value)
		}
	}
	values := lastByKey(candidates, hex.EncodeToString)
	require(len(values) > 0 && len(values) <= 32, "HXV4_BOOTSTRAP_UNAVAILABLE")
	return values
}

// unkeyedHashers accepts only the constructor shape that publishes a zero-length key, recovered through RTTI/vtables.
func unkeyedHashers(data view, image *pe) bool {
	for _, name := range []string{"PathNameHashTrait", "FileNameHashTrait"} {
		if !unkeyedHasher(data, image, name) {
			return false
		}
	}
	return true
}

// vtablesOf collects vtables whose complete object locator column references the RTTI type descriptor.
func vtablesOf(data view, image *pe, typeVA int) map[uint32]bool {
	tables := map[uint32]bool{}
	for at := 12; at+8 <= len(data); at += 4 {
		if int(data.u32(at)) != typeVA || data.u32(at-12) != 0 || data.u32(at-8) != 0 {
			continue
		}
		columnVA, ok := image.toVA(at - 12)
		if !ok {
			continue
		}
		for v := 0; v+12 <= len(data); v += 4 {
			if int(data.u32(v)) != columnVA {
				continue
			}
			if _, executable := image.fromVA(int(data.u32(v+8)), 1, 1); !executable {
				continue
			}
			if table, ok := image.toVA(v + 4); ok {
				tables[uint32(table)] = true
			}
		}
	}
	return tables
}

// zeroKeyConstructor stores a known vtable followed by zero key pointer and length fields.
func zeroKeyConstructor(data view, p int, tables map[uint32]bool) bool {
	m := int(data[p+1])
	reg := m & 7
	if data[p] != 0xc7 || m>>3 != 0 || reg >= 4 && reg <= 5 || !tables[data.u32(p+2)] {
		return false
	}
	zero := func(offset int) bool {
		return data.at(p+offset) == 0xc7 && data.at(p+offset+1) == 0x40|reg && data.u32(p+offset+3) == 0
	}
	return zero(6) && data[p+8] == 4 && zero(13) && data[p+15] == 8
}

func unkeyedHasher(data view, image *pe, name string) bool {
	marker := []byte(".?AU?$DefaultCompoundHasher@U" + name + "@@@@\x00")
	typeAt := data.indexOf(marker, 0)
	if typeAt < 8 {
		return false
	}
	tables := map[uint32]bool{}
	if typeVA, typeKnown := image.toVA(typeAt - 8); typeKnown {
		tables = vtablesOf(data, image, typeVA)
	}
	for _, item := range image.executableSections() {
		for p := item.raw; p+20 <= item.end; p++ {
			if zeroKeyConstructor(data, p, tables) {
				return true
			}
		}
	}
	return false
}

type hxProfile struct {
	params                         []byte
	warning, unique                string
	prefixes                       []string
	seeds                          [][]byte
	strings                        []string
	bootstrapSHA256, startupSHA256 string
	sourceModuleSHA256             string
}

var (
	trailingNulls  = regexp.MustCompile(`\x00+$`)
	bootstrapEntry = regexp.MustCompile(`(?i)^bres:.*/bootstrap/?$`)
)

func printableText(value string) bool {
	for _, character := range value {
		if character < 32 {
			return false
		}
	}
	return true
}

func discoverHXBootstrap(data view) *hxProfile {
	image := parsePE(data)
	if image == nil {
		return nil
	}
	resources := peResources(data, image)
	startup, bootstrap, root := resources["10/STARTUP.TJS"], resources["10/BOOTSTRAP"], resources["TEXT/127"]
	if startup == nil || bootstrap == nil || root == nil {
		return nil
	}
	rootPath := bresPath(trailingNulls.ReplaceAllString(mustUTF16(root), ""))
	var accepted []*hxProfile
	for _, salt := range hxSalts(data, image) {
		plain := decryptBres(startup, rootPath, salt)
		if !bytes.HasPrefix(plain, tjsSignature) {
			continue
		}
		accepted = append(accepted, bootstrapProfile(data, bootstrap, plain, salt))
	}
	require(len(accepted) == 1, "HXV4_BOOTSTRAP_UNAVAILABLE")
	return accepted[0]
}

func bootstrapProfile(data view, bootstrap, plain, salt []byte) *hxProfile {
	pool := hxTJSStrings(plain)
	var paths []string
	for _, value := range pool {
		if bootstrapEntry.MatchString(value) {
			if path := bresPath(value); !containsText(paths, path) {
				paths = append(paths, path)
			}
		}
	}
	require(len(paths) == 1, "HXV4_BOOTSTRAP_UNAVAILABLE")
	packed := view(decryptBres(bootstrap, paths[0], salt))
	require(len(packed) >= 8 && int(packed.u32(0)) == len(packed)-8)
	dll := inflate(packed[8:], int64(packed.u32(4)))
	native := parsePE(dll)
	require(native != nil && unkeyedHashers(dll, native), "HXV4_HASHER_UNSUPPORTED")
	params := append([]byte(nil), hxConfig(dll, "PARAMS", validHXParams)...)
	warning := string(hxConfig(dll, "WARNING", func(value []byte) bool {
		if len(value) == 0 {
			return false
		}
		for _, item := range value {
			if item < 32 || item > 126 {
				return false
			}
		}
		return true
	}))
	unique := mustUTF16(hxConfig(dll, "UNIQUE", func(value []byte) bool {
		text, ok := strictUTF16(value)
		return ok && len(value) > 0 && printableText(text)
	}))
	var prefixes []string
	for _, value := range append(filterPrefixes(pool), unique) {
		if !containsText(prefixes, value) {
			prefixes = append(prefixes, value)
		}
	}
	sort.SliceStable(prefixes, func(i, j int) bool { return rulesLength(prefixes[i]) > rulesLength(prefixes[j]) })
	require(len(prefixes) <= 256, "MODULE_LIMIT")
	return &hxProfile{
		params: params, warning: warning, unique: unique, prefixes: prefixes, seeds: hxSeeds(dll, native),
		strings: pool, bootstrapSHA256: digest(dll), startupSHA256: digest(plain), sourceModuleSHA256: digest(data),
	}
}

func filterPrefixes(values []string) []string {
	var result []string
	for _, value := range values {
		if value != "" && rulesLength(value) <= 4096 && printableText(value) {
			result = append(result, value)
		}
	}
	return result
}

func containsText(values []string, value string) bool {
	for _, item := range values {
		if item == value {
			return true
		}
	}
	return false
}
