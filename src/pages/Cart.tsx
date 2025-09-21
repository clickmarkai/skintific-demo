import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'

type Line = { id?: string; product_id?: string; variant_id?: string; product_name: string; qty: number; unit_price_cents: number; image_url?: string }

const format = (cents: number) => `$${(cents/100).toFixed(2)}`

export default function CartPage() {
  const [lines, setLines] = useState<Line[]>([])
  const [loading, setLoading] = useState(true)
  const [subtotal, setSubtotal] = useState(0)
  const { user } = useAuth()
  const [method, setMethod] = useState<'bank'|'card'|'qris'>('bank')

  const resolveSessionId = async (): Promise<string> => {
    let sid = ''
    try { sid = localStorage.getItem('session_id') || '' } catch {}
    if (user && supabase) {
      try {
        const { data: sessionData } = await supabase
          .from('sessions')
          .select('id')
          .eq('user_id', user.id)
          .order('started_at', { ascending: false })
          .limit(1)
          .single()
        if (sessionData?.id) {
          sid = sessionData.id
          try { localStorage.setItem('session_id', sid) } catch {}
        }
      } catch {}
    }
    if (!sid) {
      sid = crypto.randomUUID()
      try { localStorage.setItem('session_id', sid) } catch {}
    }
    return sid
  }

  const callChat = async (payload: any) => {
    if (supabase) {
      const { data, error } = await (supabase as any).functions.invoke('chat', { body: payload })
      if (error) throw error
      return data
    }
    const url = (import.meta as any).env?.VITE_SUPABASE_FUNCTION_URL || ''
    if (!url) throw new Error('Missing VITE_SUPABASE_FUNCTION_URL')
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    if (!res.ok) throw new Error('Network error')
    return await res.json()
  }

  const load = async () => {
    setLoading(true)
    try {
      const sessionId = await resolveSessionId()
      const data = await callChat({ intent: 'get_cart_info', session_id: sessionId })
      const items = (data?.cart?.items || []) as any[]
      setLines(items.map(it => ({ product_name: it.product_name, qty: it.qty || 0, unit_price_cents: it.unit_price_cents || 0, image_url: it.image_url, product_id: it.product_id, variant_id: it.variant_id })))
      setSubtotal((data?.cart?.subtotal_cents || 0))
    } catch {}
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const updateQty = async (line: Line, qty: number) => {
    const sessionId = await resolveSessionId()
    const data = await callChat({ intent: 'edit_line', session_id: sessionId, product_name: line.product_name, product_id: line.product_id, variant_id: line.variant_id, qty })
    const items = (data?.cart?.items || []) as any[]
    setLines(items.map(it => ({ product_name: it.product_name, qty: it.qty || 0, unit_price_cents: it.unit_price_cents || 0, image_url: it.image_url, product_id: it.product_id, variant_id: it.variant_id })))
    setSubtotal((data?.cart?.subtotal_cents || 0))
  }

  const removeLine = async (line: Line) => {
    const sessionId = await resolveSessionId()
    const data = await callChat({ intent: 'delete_line', session_id: sessionId, product_name: line.product_name, product_id: line.product_id, variant_id: line.variant_id })
    const items = (data?.cart?.items || []) as any[]
    setLines(items.map(it => ({ product_name: it.product_name, qty: it.qty || 0, unit_price_cents: it.unit_price_cents || 0, image_url: it.image_url, product_id: it.product_id, variant_id: it.variant_id })))
    setSubtotal((data?.cart?.subtotal_cents || 0))
  }

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">Your cart</h1>
      {loading ? (
        <div>Loading…</div>
      ) : lines.length === 0 ? (
        <div>Your cart is empty.</div>
      ) : (
        <div className="space-y-4">
          {lines.map((it, idx) => (
            <div key={idx} className="flex items-center gap-4 p-4 border rounded-lg bg-white">
              {it.image_url && (
                <img
                  src={it.image_url}
                  alt={it.product_name}
                  className="w-16 h-16 rounded object-cover border"
                  loading="lazy"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).src = '/placeholder.svg'; }}
                />
              )}
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate" title={it.product_name}>{it.product_name}</div>
                <div className="text-sm text-gray-600">{format(it.unit_price_cents)} each</div>
                <div className="mt-2 inline-flex items-center rounded-md border bg-white">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => updateQty(it, Math.max(0, it.qty - 1))}>-</Button>
                  <span className="w-8 text-center">{it.qty}</span>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => updateQty(it, it.qty + 1)}>+</Button>
                </div>
              </div>
              <div className="text-right">
                <div className="font-medium">{format(it.unit_price_cents * it.qty)}</div>
                <Button variant="link" className="text-red-600 p-0" onClick={() => removeLine(it)}>Remove</Button>
              </div>
            </div>
          ))}

          <div className="p-4 border rounded-lg bg-white space-y-3">
            <div className="flex justify-between"><span className="text-gray-600">Subtotal</span><span>{format(subtotal)}</span></div>
            <div className="flex justify-between font-semibold"><span>Total</span><span>{format(subtotal)}</span></div>

            <div>
              <div className="text-sm font-medium mb-2">Payment method</div>
              <div className="grid grid-cols-3 gap-2">
                <Button variant={method==='bank'?'default':'outline'} onClick={()=>setMethod('bank')}>Bank</Button>
                <Button variant={method==='card'?'default':'outline'} onClick={()=>setMethod('card')}>Credit Card</Button>
                <Button variant={method==='qris'?'default':'outline'} onClick={()=>setMethod('qris')}>QRIS</Button>
              </div>
            </div>

            <div className="pt-1">
              {method === 'bank' && (
                <div className="text-sm text-gray-700">We support bank transfer (BCA, BNI, Mandiri). You’ll receive virtual account details after placing the order.</div>
              )}
              {method === 'card' && (
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <input className="border rounded px-2 py-2" placeholder="Card holder name" />
                  <input className="border rounded px-2 py-2" placeholder="Card number" />
                  <input className="border rounded px-2 py-2" placeholder="MM/YY" />
                  <input className="border rounded px-2 py-2" placeholder="CVC" />
                </div>
              )}
              {method === 'qris' && (
                <div className="text-sm text-gray-700">Use QRIS to pay from any supported e-wallet or mobile banking app.</div>
              )}
            </div>

            <div className="mt-1 flex gap-2">
              <Button className="bg-primary text-white" onClick={()=>{
                if(method==='qris') {
                  const sid = localStorage.getItem('session_id') || ''
                  const url = `/payment/qris?amount=${subtotal}&session=${encodeURIComponent(sid)}`
                  window.open(url, '_blank')
                  return
                }
                alert('Payment initialized: '+method)
              }}>Pay now</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


