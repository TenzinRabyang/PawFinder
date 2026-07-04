import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_mock', {
  apiVersion: '2025-01-27.acacia' as any
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { tier } = await request.json()

  // Find user's provider
  const { data: profile } = await supabase
    .from('pf_profiles')
    .select('owned_provider_id')
    .eq('id', user.id)
    .single()

  if (!profile?.owned_provider_id) {
    return NextResponse.json({ error: 'No business claimed' }, { status: 400 })
  }

  const prices = {
    verified: 'price_mock_verified', // Replace with real price ID
    premium: 'price_mock_premium'
  }

  const priceId = prices[tier as keyof typeof prices]

  if (!priceId) {
    return NextResponse.json({ error: 'Invalid tier' }, { status: 400 })
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${new URL(request.url).origin}/business/dashboard?success=true`,
      cancel_url: `${new URL(request.url).origin}/business/subscribe?canceled=true`,
      client_reference_id: profile.owned_provider_id, // link back to provider
      metadata: {
        provider_id: profile.owned_provider_id,
        tier
      }
    })

    return NextResponse.json({ url: session.url })
  } catch (err: any) {
    if (process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json({ error: err.message }, { status: 500 })
    }

    return NextResponse.json(
      {
        error: 'Stripe is not configured in this environment. Add Stripe secrets to create a real checkout session.',
      },
      { status: 503 }
    )
  }
}
