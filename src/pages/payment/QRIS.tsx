import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase'

type Line = { product_name: string; qty: number; unit_price_cents: number; image_url?: string }

function generateRandomPayload(session: string, amount: number) {
  const rand = Math.random().toString(36).slice(2, 10).toUpperCase()
  return `00020101021115310003ID.QR9204${rand}5802ID5910SKINTIFIC6007JAKARTA5406${(amount/100).toFixed(2).replace('.', '')}6207${session.slice(0,8)}6304ABCD`
}

const format = (cents: number) => `$${(cents/100).toFixed(2)}`

export default function QRISPage() {
  const params = new URLSearchParams(location.search)
  const amount = parseInt(params.get('amount') || '0', 10)
  const session = params.get('session') || ''

  const payload = useMemo(() => generateRandomPayload(session, amount), [session, amount])
  const qrUrl = useMemo(() => {
    const size = 280
    const text = encodeURIComponent(payload)
    return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${text}`
  }, [payload])

  const [lines, setLines] = useState<Line[]>([])
  const [subtotal, setSubtotal] = useState(0)

  const callChat = async (payload: any) => {
    if (supabase) {
      const { data, error } = await (supabase as any).functions.invoke('chat', { body: payload })
      if (error) throw error
      return data
    }
    const url = (import.meta as any).env?.VITE_SUPABASE_FUNCTION_URL || ''
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    return await res.json()
  }

  useEffect(() => {
    const load = async () => {
      try {
        const data = await callChat({ intent: 'get_cart_info', session_id: session })
        const items = (data?.cart?.items || []) as any[]
        setLines(items.map(it => ({ product_name: it.product_name, qty: it.qty || 0, unit_price_cents: it.unit_price_cents || 0, image_url: it.image_url })))
        setSubtotal((data?.cart?.subtotal_cents || 0))
      } catch {}
    }
    if (session) load()
  }, [session])

  const invoiceId = useMemo(() => `INV-${(session || 'XXXX').replace(/-/g,'').slice(0,8).toUpperCase()}-${Date.now().toString().slice(-6)}`, [session])

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">QRIS Payment</h1>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="border rounded-lg p-4 bg-white">
          <div className="text-sm text-gray-600 mb-3">Scan this QR with your e-wallet or mobile banking app.</div>
          <div className="flex items-center justify-center">
            <img src={qrUrl} alt="QRIS" className="w-72 h-72 border rounded" />
          </div>
          <div className="mt-4 text-sm space-y-1">
            <div><span className="text-gray-600">Amount:</span> <span className="font-medium">{format(amount)}</span></div>
            <div><span className="text-gray-600">Merchant:</span> <span className="font-medium">SKINTIFIC</span></div>
            <div><span className="text-gray-600">Invoice:</span> <span className="font-mono text-gray-800">{invoiceId}</span></div>
            <div className="text-gray-600">Scan with any QRIS app to pay. Keep this page open until payment completes.</div>
          </div>
          <div className="mt-4 flex gap-2">
            <Button variant="outline" onClick={()=>window.print()}>Print</Button>
          </div>
        </div>

        <div className="border rounded-lg p-4 bg-white">
          <div className="flex items-center justify-between mb-2">
            <div className="font-semibold">Invoice</div>
            <div className="text-xs text-gray-500">{new Date().toLocaleString()}</div>
          </div>
          <div className="text-xs text-gray-600 mb-3">Payment method: <span className="font-medium text-gray-800">QRIS</span></div>

          {lines.length === 0 ? (
            <div className="text-sm text-gray-600">No items found for this session.</div>
          ) : (
            <div className="space-y-3">
              {lines.map((it, idx) => (
                <div key={idx} className="flex items-center gap-3">
                  {it.image_url && <img src={it.image_url} alt={it.product_name} className="w-12 h-12 rounded object-cover border" onError={(e)=>{(e.currentTarget as HTMLImageElement).src='/placeholder.svg'}} />}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate" title={it.product_name}>{it.product_name}</div>
                    <div className="text-xs text-gray-600">{it.qty} × {format(it.unit_price_cents)}</div>
                  </div>
                  <div className="text-sm font-medium">{format(it.unit_price_cents * it.qty)}</div>
                </div>
              ))}

              <div className="border-t pt-3 space-y-1 text-sm">
                <div className="flex justify-between"><span>Subtotal</span><span>{format(subtotal)}</span></div>
                <div className="flex justify-between font-semibold"><span>Total</span><span>{format(subtotal)}</span></div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}


