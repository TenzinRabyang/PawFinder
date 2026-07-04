import { normalizeGeneralAnimalCoverage } from '@/lib/breed-taxonomy'

export const MAX_PROVIDER_PHOTO_ANALYSIS_PHOTOS = 3

const GOOGLE_PHOTO_MAX_WIDTH = 640
const PHOTO_ANALYSIS_MODEL = 'gpt-4o-mini'
const PHOTO_ANALYSIS_TIMEOUT_MS = 20000

type PlacePhoto = {
  photo_reference?: string | null
}

type PhotoWithReference = {
  photo_reference: string
}

type PhotoInferenceResponse = {
  animals_present?: unknown
  breeds_general_inferred?: unknown
  has_visible_animals?: unknown
}

export type ProviderPhotoInferenceResult = {
  breeds_general_inferred: string[]
  analyzed_photo_count: number
  available_photo_count: number
  model: string
}

function buildPhotoPrompt(providerName: string) {
  return [
    `You are classifying Google business photos for "${providerName}".`,
    'Return JSON only in this shape:',
    '{"animals_present":["dog","cat"],"has_visible_animals":true}',
    'Rules:',
    '- Only allowed animals: dog, cat, rabbit.',
    '- Only include an animal if it is clearly visible in at least one photo.',
    '- Do not guess breed or species detail beyond dog, cat, rabbit.',
    '- Ignore humans, tools, interiors, logos, text, and grooming equipment.',
    '- If no animal is clearly visible, return {"animals_present":[],"has_visible_animals":false}.',
  ].join('\n')
}

function getMimeType(response: Response) {
  const contentType = response.headers.get('content-type') || ''

  if (contentType.startsWith('image/png')) return 'image/png'
  if (contentType.startsWith('image/webp')) return 'image/webp'
  if (contentType.startsWith('image/gif')) return 'image/gif'
  return 'image/jpeg'
}

async function fetchPhotoAsDataUrl(photoReference: string, googleApiKey: string) {
  const photoUrl =
    `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${GOOGLE_PHOTO_MAX_WIDTH}` +
    `&photoreference=${encodeURIComponent(photoReference)}&key=${googleApiKey}`

  const response = await fetch(photoUrl, {
    redirect: 'follow',
    signal: AbortSignal.timeout(PHOTO_ANALYSIS_TIMEOUT_MS),
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`Google photo fetch failed with status ${response.status}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  const mimeType = getMimeType(response)
  const base64 = Buffer.from(arrayBuffer).toString('base64')
  return `data:${mimeType};base64,${base64}`
}

async function requestOpenAiPhotoClassification(providerName: string, imageUrls: string[]) {
  const key = process.env.OPENAI_API_KEY

  if (imageUrls.length === 0) {
    return []
  }

  if (!key) {
    throw new Error('Missing OPENAI_API_KEY for provider photo analysis')
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    signal: AbortSignal.timeout(PHOTO_ANALYSIS_TIMEOUT_MS),
    body: JSON.stringify({
      model: PHOTO_ANALYSIS_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: buildPhotoPrompt(providerName),
            },
            ...imageUrls.map((url) => ({
              type: 'image_url',
              image_url: {
                url,
                detail: 'low',
              },
            })),
          ],
        },
      ],
      response_format: { type: 'json_object' },
    }),
  })

  const rawBody = await response.text()
  if (!response.ok) {
    throw new Error(`OpenAI photo classification failed (${response.status}): ${rawBody}`)
  }

  const data = JSON.parse(rawBody)
  const content = data?.choices?.[0]?.message?.content
  const parsed = JSON.parse(content || '{}') as PhotoInferenceResponse

  return normalizeGeneralAnimalCoverage(parsed.animals_present || parsed.breeds_general_inferred || [])
}

async function classifyAcrossPhotos(providerName: string, imageUrls: string[]) {
  try {
    return await requestOpenAiPhotoClassification(providerName, imageUrls)
  } catch (combinedError) {
    console.warn('[photo-inference] combined OpenAI photo classification failed, retrying per photo', {
      providerName,
      photoCount: imageUrls.length,
      error: combinedError instanceof Error ? combinedError.message : String(combinedError),
    })

    const aggregatedAnimals = new Set<string>()
    let successfulSinglePhotoClassification = false
    let lastSingleError: unknown = combinedError

    for (const imageUrl of imageUrls) {
      try {
        const animals = await requestOpenAiPhotoClassification(providerName, [imageUrl])
        successfulSinglePhotoClassification = true
        for (const animal of animals) {
          aggregatedAnimals.add(animal)
        }
      } catch (singleError) {
        lastSingleError = singleError
        console.warn('[photo-inference] single-photo OpenAI classification failed', {
          providerName,
          error: singleError instanceof Error ? singleError.message : String(singleError),
        })
      }
    }

    if (!successfulSinglePhotoClassification) {
      throw (lastSingleError instanceof Error
        ? lastSingleError
        : new Error(typeof lastSingleError === 'string' ? lastSingleError : 'OpenAI photo classification failed'))
    }

    return Array.from(aggregatedAnimals)
  }
}

export async function inferAnimalsFromProviderPhotos({
  providerName,
  photos,
  googleApiKey,
}: {
  providerName: string
  photos: PlacePhoto[]
  googleApiKey: string
}): Promise<ProviderPhotoInferenceResult> {
  const selectedPhotos = photos
    .filter((photo): photo is PhotoWithReference => typeof photo.photo_reference === 'string' && photo.photo_reference.length > 0)
    .slice(0, MAX_PROVIDER_PHOTO_ANALYSIS_PHOTOS)

  const imageUrls: string[] = []

  for (const photo of selectedPhotos) {
    try {
      imageUrls.push(await fetchPhotoAsDataUrl(photo.photo_reference, googleApiKey))
    } catch (error) {
      console.warn('[photo-inference] failed to fetch Google photo for analysis', {
        providerName,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const breeds_general_inferred =
    imageUrls.length > 0 ? await classifyAcrossPhotos(providerName, imageUrls) : []

  return {
    breeds_general_inferred,
    analyzed_photo_count: imageUrls.length,
    available_photo_count: selectedPhotos.length,
    model: PHOTO_ANALYSIS_MODEL,
  }
}
