package toolkit_test

import (
	"testing"

	"example.com/inventoryfixture"
)

func TestExternalReference(t *testing.T) {
	_ = toolkit.Exported
	_ = toolkit.Box[int]{}
}
