package kirikiri

// guard runs fn and converts a raised format failure into an error.
// Parsers raise failures by panicking with an error value; any other panic is a programming defect.
func guard[T any](fn func() T) (T, error) {
	var result T
	var err error
	func() {
		defer func() {
			if recovered := recover(); recovered != nil {
				failure, ok := recovered.(error)
				if !ok {
					panic(recovered)
				}
				err = failure
			}
		}()
		result = fn()
	}()
	return result, err
}

// check runs fn and converts a raised format failure into an error.
func check(fn func()) error {
	_, err := guard(func() struct{} {
		fn()
		return struct{}{}
	})
	return err
}
