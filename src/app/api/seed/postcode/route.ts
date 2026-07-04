import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { tagProviderWebsite, type AiTags } from '@/lib/provider-ai-tagging'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

async function getPostcodeCoords(postcode: string) {
  const res = await fetch(`https://api.postcodes.io/postcodes/${postcode}`)
  if (!res.ok) return null
  const data = await res.json()
  return data.result ? { lat: data.result.latitude, lng: data.result.longitude } : null
}

async function searchGooglePlaces(lat: number, lng: number, keyword: string) {
  const key = process.env.GOOGLE_PLACES_API_KEY
  if (!key) return []
  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=5000&keyword=${encodeURIComponent(keyword)}&key=${key}`
  const res = await fetch(url)
  const data = await res.json()
  return data.results || []
}

async function getPlaceDetails(placeId: string) {
  const key = process.env.GOOGLE_PLACES_API_KEY
  if (!key) return null
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=formatted_phone_number,website&key=${key}`
  const res = await fetch(url)
  const data = await res.json()
  return data.result || null
}

export async function POST(request: Request) {
  try {
    const { postcode } = await request.json()
    if (!postcode) return NextResponse.json({ error: 'Postcode required' }, { status: 400 })

    const coords = await getPostcodeCoords(postcode)
    if (!coords) return NextResponse.json({ error: 'Invalid postcode' }, { status: 400 })

    const categories = [
      { key: 'vet', query: 'veterinary clinic' },
      { key: 'groomer', query: 'pet groomer' },
      { key: 'walker', query: 'dog walker' },
      { key: 'kennel', query: 'dog kennel boarding' },
      { key: 'pet_shop', query: 'pet shop' },
      { key: 'mobile_service', query: 'mobile pet service' }
    ]

    let added = 0
    let skipped = 0
    let failed = 0

    for (const cat of categories) {
      const places = await searchGooglePlaces(coords.lat, coords.lng, cat.query)
      
      for (const place of places.slice(0, 5)) { // Limit to 5 per category for demo/cost
        try {
          // Check if exists
          const { data: existing } = await supabaseAdmin
            .from('pf_providers')
            .select('id')
            .eq('google_place_id', place.place_id)
            .single()

          if (existing) {
            skipped++
            continue
          }

          // Fetch details
          const details = await getPlaceDetails(place.place_id)
          let aiTags: AiTags = {
            animals_served: [],
            services: [],
            breeds_specialised: [],
            breeds_general_inferred: [],
            has_online_booking: false,
          }
          let normalizedWebsite: string | null = details?.website || null
          let aiTaggedAt: string | null = null
          let skippedLowContent = false
          
          if (details?.website) {
            const taggingResult = await tagProviderWebsite(details.website)
            aiTags = taggingResult.aiTags
            normalizedWebsite = taggingResult.normalizedWebsite
            skippedLowContent = taggingResult.skippedLowContent
            aiTaggedAt = new Date().toISOString()
          }

          // Insert Provider
          const { data: provider, error: providerError } = await supabaseAdmin
            .from('pf_providers')
            .insert({
              name: place.name,
              category: cat.key,
              address: place.vicinity,
              postcode: postcode, // approximate, or extract from vicinity
              phone: details?.formatted_phone_number || null,
              website: normalizedWebsite,
              google_place_id: place.place_id,
              animals_served: aiTags.animals_served || [],
              services: aiTags.services || [],
              breeds_specialised: aiTags.breeds_specialised || [],
              breeds_general_inferred: aiTags.breeds_general_inferred || [],
              ai_tagged_at: aiTaggedAt,
              ai_tagging_skipped_low_content: skippedLowContent,
            })
            .select()
            .single()

          if (providerError) {
            console.error('Insert error', providerError)
            failed++
            continue
          }

          // Insert Coords
          if (provider && place.geometry?.location) {
            await supabaseAdmin
              .from('pf_provider_coords')
              .insert({
                provider_id: provider.id,
                lat: place.geometry.location.lat,
                lng: place.geometry.location.lng
              })
          }
          
          added++
        } catch (e) {
          console.error(e)
          failed++
        }
      }
    }

    return NextResponse.json({ success: true, added, skipped, failed })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
