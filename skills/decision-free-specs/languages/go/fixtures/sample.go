// Package toolkit exercises the Go inventory fixture.
//go:generate stringer -type State
package toolkit

import (
	"embed"
	"fmt"
)

const (
	Public = 1
	private = 2
	_ = 3
)

const First, Second = 1, 2

var Plain int

var Initialized = fmt.Sprint(Public)

var Left, Right = 1, 2

// Asset is fixture data.
//go:embed asset.txt
var Asset string

// State is a state value.
type State int

type oldState = State

type Box[T any] struct {
	Value T
}

type Boxes[T any] = []Box[T]

type Pair[A, B any] struct {
	First  A
	Second B
}

// Exported reports the state.
func Exported(value State) string {
	return fmt.Sprint(value)
}

func helper() {}

func init() {
	Plain = Public
}

func init() {
	Plain += First
}

func (box *Box[T]) Get() T {
	return box.Value
}

func (pair Pair[A, B]) Swap() Pair[B, A] {
	return Pair[B, A]{First: pair.Second, Second: pair.First}
}

const Δelta = 4

var _ embed.FS
