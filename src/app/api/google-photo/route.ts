import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const photoReference = searchParams.get('photoReference')
  const width = Number(searchParams.get('width') || '800')
  const key = process.env.GOOGLE_PLACES_API_KEY

  if (!photoReference || !key) {
    return NextResponse.json({ error: 'Missing photo reference or API key' }, { status: 400 })
  }

  const safeWidth = Number.isFinite(width) ? Math.min(Math.max(width, 120), 1600) : 800
  const photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${safeWidth}&photoreference=${encodeURIComponent(photoReference)}&key=${key}`

  return NextResponse.redirect(photoUrl)
}
