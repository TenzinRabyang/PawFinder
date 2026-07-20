import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import Stripe from 'stripe'
import { validateSameOriginRequest } from '@/lib/csrf'

function createStripeClient() {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY

  if (!stripeSecretKey) {
    return null
  }

  return new Stripe(stripeSecretKey)
}

export async function POST(request: Request) {
  const csrfError = validateSameOriginRequest(request)
  if (csrfError) {
    return NextResponse.json({ error: csrfError }, { status: 403 })
  }

  const stripe = createStripeClient()
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
    verified: process.env.STRIPE_PRICE_ID_VERIFIED,
    premium: process.env.STRIPE_PRICE_ID_PREMIUM,
  }

  const priceId = prices[tier as keyof typeof prices]

  if (!priceId) {
    return NextResponse.json({ error: 'Stripe pricing is not configured for this tier' }, { status: 503 })
  }

  if (!stripe) {
    return NextResponse.json(
      {
        error: 'Stripe is not configured in this environment. Add Stripe secrets to create a real checkout session.',
      },
      { status: 503 }
    )
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
  } catch {
    return NextResponse.json({ error: 'Unable to create checkout session' }, { status: 500 })
  }
}
