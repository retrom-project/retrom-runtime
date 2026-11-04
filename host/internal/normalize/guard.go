package normalize

// guarded runs fn and converts a raised format failure into an error.
// Parsers raise failures by panicking with an error value; any other panic is a programming defect.
func guarded[T any](fn func() (T, error)) (T, error) {
	var result T
	var err error
	func() {
		defer recoverFailure(&err)
		result, err = fn()
	}()
	return result, err
}
