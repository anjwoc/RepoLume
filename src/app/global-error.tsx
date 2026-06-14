'use client'

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html>
      <body style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'sans-serif', background: '#0a0a0a', color: '#e5e5e5' }}>
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ marginBottom: 12, fontSize: 20 }}>오류가 발생했습니다</h2>
          <button
            onClick={() => reset()}
            style={{ padding: '8px 20px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}
          >
            다시 시도
          </button>
        </div>
      </body>
    </html>
  )
}
