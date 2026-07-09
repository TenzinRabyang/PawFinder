import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_mock', {
  apiVersion: '2025-01-27.acacia' as any,
})

function mapStripeStatusToTier(status: string, requestedTier: string | null | undefined) {
  if (status === 'active' || status === 'trialing') {
    return requestedTier === 'premium' ? 'premium' : 'verified'
  }

  return 'free'
}

export async function POST(request: Request) {
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  const signature = request.headers.get('stripe-signature')
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  if (!signature || !webhookSecret) {
    return NextResponse.json({ error: 'Missing Stripe webhook configuration' }, { status: 400 })
  }

  const payload = await request.text()
  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(payload, signature, webhookSecret)
  } catch (error: any) {
    return NextResponse.json({ error: `Webhook signature verification failed: ${error.message}` }, { status: 400 })
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session
      const providerId = session.metadata?.provider_id || session.client_reference_id
      const tier = session.metadata?.tier || 'verified'
      const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id

      if (providerId) {
        await supabaseAdmin
          .from('pf_subscriptions')
          .upsert(
            {
              provider_id: providerId,
              stripe_customer_id: customerId || null,
              status: 'trialing',
              current_period_end: null,
            },
            { onConflict: 'provider_id' }
          )

        await supabaseAdmin
          .from('pf_providers')
          .update({
            subscription_tier: tier,
            is_verified: tier === 'verified' || tier === 'premium',
          })
          .eq('id', providerId)
      }
    }

    if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object as Stripe.Subscription
      const subscriptionCurrentPeriodEnd = (subscription as any).current_period_end as number | null | undefined
      const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id

      if (customerId) {
        const { data: existingSubscription } = await supabaseAdmin
          .from('pf_subscriptions')
          .select('provider_id')
          .eq('stripe_customer_id', customerId)
          .maybeSingle()

        if (existingSubscription?.provider_id) {
          await supabaseAdmin
            .from('pf_subscriptions')
            .update({
              status: subscription.status as 'active' | 'cancelled' | 'trialing',
              current_period_end: subscriptionCurrentPeriodEnd
                ? new Date(subscriptionCurrentPeriodEnd * 1000).toISOString()
                : null,
            })
            .eq('stripe_customer_id', customerId)

          await supabaseAdmin
            .from('pf_providers')
            .update({
              subscription_tier: mapStripeStatusToTier(subscription.status, subscription.metadata?.tier),
              is_verified: subscription.status === 'active' || subscription.status === 'trialing',
            })
            .eq('id', existingSubscription.provider_id)
        }
      }
    }

    return NextResponse.json({ received: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Webhook handling failed' }, { status: 500 })
  }
}
