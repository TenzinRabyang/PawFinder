import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const placeId = searchParams.get('placeId')?.trim() || ''

  if (!placeId) {
    return NextResponse.json({ error: 'placeId is required' }, { status: 400 })
  }

  const key = process.env.GOOGLE_PLACES_API_KEY
  if (!key) {
    return NextResponse.json({ error: 'Google Places API key is missing' }, { status: 500 })
  }

  const url =
    `https://maps.googleapis.com/maps/api/place/details/json?` +
    `place_id=${encodeURIComponent(placeId)}` +
    `&fields=geometry,name,formatted_address` +
    `&key=${key}`

  try {
    const response = await fetch(url, { cache: 'no-store' })
    const data = await response.json()

    if (!response.ok || data.status !== 'OK' || !data.result?.geometry?.location) {
      console.error('[location-details] Google Places details failed', {
        placeId,
        status: data.status,
        errorMessage: data.error_message,
      })

      return NextResponse.json({ error: 'Failed to load location details' }, { status: 500 })
    }

    return NextResponse.json({
      place_id: placeId,
      name: data.result.name || '',
      formatted_address: data.result.formatted_address || '',
      lat: data.result.geometry.location.lat,
      lng: data.result.geometry.location.lng,
    })
  } catch (error) {
    console.error('[location-details] Request failed', error)
    return NextResponse.json({ error: 'Failed to load location details' }, { status: 500 })
  }
}
