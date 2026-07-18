import { NextResponse } from 'next/server'

type GooglePrediction = {
  description?: string
  place_id?: string
  structured_formatting?: {
    main_text?: string
    secondary_text?: string
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const input = searchParams.get('input')?.trim() || ''

  if (input.length < 3) {
    return NextResponse.json({ suggestions: [] })
  }

  const key = process.env.GOOGLE_PLACES_API_KEY
  if (!key) {
    return NextResponse.json({ error: 'Google Places API key is missing' }, { status: 500 })
  }

  const url =
    `https://maps.googleapis.com/maps/api/place/autocomplete/json?` +
    `input=${encodeURIComponent(input)}` +
    `&components=country:uk` +
    `&types=${encodeURIComponent('geocode')}` +
    `&language=en-GB` +
    `&key=${key}`

  try {
    const response = await fetch(url, { cache: 'no-store' })
    const data = await response.json()

    if (!response.ok || (data.status !== 'OK' && data.status !== 'ZERO_RESULTS')) {
      console.error('[location-autocomplete] Google Places autocomplete failed')
      return NextResponse.json({ error: 'Failed to load location suggestions' }, { status: 500 })
    }

    const suggestions = (data.predictions || []).slice(0, 6).map((prediction: GooglePrediction) => ({
      description: prediction.description || '',
      place_id: prediction.place_id || '',
      main_text: prediction.structured_formatting?.main_text || prediction.description || '',
      secondary_text: prediction.structured_formatting?.secondary_text || '',
    }))

    return NextResponse.json({ suggestions })
  } catch {
    console.error('[location-autocomplete] Request failed')
    return NextResponse.json({ error: 'Failed to load location suggestions' }, { status: 500 })
  }
}
