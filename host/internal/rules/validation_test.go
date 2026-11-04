package rules

import "testing"

func TestCaseMappingFollowsJavaScript(t *testing.T) {
	for _, item := range []struct{ value, upper, lower string }{
		{"abc/Def.zip", "ABC/DEF.ZIP", "abc/def.zip"},
		{"straße", "STRASSE", "straße"},
		{"ﬁle", "FILE", "ﬁle"},
		{"ΟΔΟΣ", "ΟΔΟΣ", "οδος"},
		{"İ", "İ", "i̇"},
		{"日本語", "日本語", "日本語"},
	} {
		if actual := Upper(item.value); actual != item.upper {
			t.Errorf("Upper(%q) = %q, want %q", item.value, actual, item.upper)
		}
		if actual := Lower(item.value); actual != item.lower {
			t.Errorf("Lower(%q) = %q, want %q", item.value, actual, item.lower)
		}
	}
}
