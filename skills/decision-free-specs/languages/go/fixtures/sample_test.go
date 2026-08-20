package toolkit

import "testing"

func TestInternalReferences(t *testing.T) {
	_ = Exported
	_ = helper
	_ = Asset
}
