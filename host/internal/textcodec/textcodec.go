// Package textcodec decodes legacy text with the fatal semantics of the WHATWG TextDecoder.
package textcodec

import (
	"bytes"
	"strings"
	"unicode/utf16"
	"unicode/utf8"

	"golang.org/x/text/encoding"
	"golang.org/x/text/encoding/japanese"
	"golang.org/x/text/encoding/korean"
	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/encoding/traditionalchinese"
)

const replacement = "�"

var legacy = map[string]encoding.Encoding{
	"shift_jis": japanese.ShiftJIS,
	"gb18030":   simplifiedchinese.GB18030,
	// The WHATWG "gbk" label decodes with the gb18030 decoder.
	"gbk":    simplifiedchinese.GB18030,
	"big5":   traditionalchinese.Big5,
	"euc-kr": korean.EUCKR,
	"euc-jp": japanese.EUCJP,
}

// Decode returns the text and whether every byte decoded without error.
// A leading BOM of the selected Unicode encoding is removed unless ignoreBOM is set.
func Decode(data []byte, label string, ignoreBOM bool) (string, bool) {
	switch label {
	case "utf-8":
		if !ignoreBOM {
			data = bytes.TrimPrefix(data, []byte{0xef, 0xbb, 0xbf})
		}
		if !utf8.Valid(data) {
			return "", false
		}
		return string(data), true
	case "utf-16le", "utf-16be":
		return decodeUTF16(data, label == "utf-16be", ignoreBOM)
	case "latin1", "windows-1252":
		return decodeWindows1252(data), true
	}
	codec, exists := legacy[label]
	if !exists {
		return "", false
	}
	decoded, err := codec.NewDecoder().Bytes(data)
	if err != nil {
		return "", false
	}
	text := string(decoded)
	if strings.Contains(text, replacement) && strings.Count(text, replacement) > legitimateReplacements(data, label) {
		return "", false
	}
	return text, true
}

// DecodeLossy decodes with replacement characters, as a non-fatal TextDecoder does.
func DecodeLossy(data []byte, label string) string {
	switch label {
	case "utf-8":
		return strings.ToValidUTF8(string(bytes.TrimPrefix(data, []byte{0xef, 0xbb, 0xbf})), replacement)
	case "latin1", "windows-1252":
		return decodeWindows1252(data)
	}
	codec, exists := legacy[label]
	if !exists {
		return ""
	}
	decoded, err := codec.NewDecoder().Bytes(data)
	if err != nil {
		return ""
	}
	return string(decoded)
}

// legitimateReplacements counts encoded U+FFFD characters, which only GB18030 can represent.
func legitimateReplacements(data []byte, label string) int {
	if label != "gb18030" && label != "gbk" {
		return 0
	}
	return bytes.Count(data, []byte{0x84, 0x31, 0xa4, 0x37})
}

func decodeUTF16(data []byte, bigEndian, ignoreBOM bool) (string, bool) {
	if len(data)%2 != 0 {
		return "", false
	}
	units := make([]uint16, len(data)/2)
	for index := range units {
		if bigEndian {
			units[index] = uint16(data[2*index])<<8 | uint16(data[2*index+1])
		} else {
			units[index] = uint16(data[2*index+1])<<8 | uint16(data[2*index])
		}
	}
	if !ignoreBOM && len(units) > 0 && units[0] == 0xfeff {
		units = units[1:]
	}
	for index := 0; index < len(units); index++ {
		unit := units[index]
		if unit >= 0xd800 && unit <= 0xdbff {
			if index+1 >= len(units) || units[index+1] < 0xdc00 || units[index+1] > 0xdfff {
				return "", false
			}
			index++
		} else if unit >= 0xdc00 && unit <= 0xdfff {
			return "", false
		}
	}
	return string(utf16.Decode(units)), true
}

// windows1252High maps 0x80-0x9f; TextDecoder("latin1") is windows-1252.
var windows1252High = [32]rune{
	0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f,
	0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
}

func decodeWindows1252(data []byte) string {
	var builder strings.Builder
	builder.Grow(len(data))
	for _, value := range data {
		if value >= 0x80 && value <= 0x9f {
			builder.WriteRune(windows1252High[value-0x80])
		} else {
			builder.WriteRune(rune(value))
		}
	}
	return builder.String()
}
