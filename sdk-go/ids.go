package promptscope

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"sync/atomic"
	"time"
)

var idFallbackCounter uint64

// newID returns a client-generated 32-character hex id, mirroring the
// Python SDK's uuid.uuid4().hex. It falls back to a timestamp+counter
// based id in the extremely unlikely event crypto/rand fails, rather than
// panicking mid-trace.
func newID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err == nil {
		return hex.EncodeToString(b[:])
	}
	n := atomic.AddUint64(&idFallbackCounter, 1)
	return fmt.Sprintf("%016x%016x", time.Now().UnixNano(), n)
}

// nowISO returns the current time as an ISO-8601 UTC timestamp
// (e.g. "2024-01-01T12:00:00.123456789Z"), matching the wire format the
// ingestion API's Pydantic datetime fields accept.
func nowISO() string {
	return time.Now().UTC().Format(time.RFC3339Nano)
}
