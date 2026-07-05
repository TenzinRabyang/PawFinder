import {
  BREED_VALUES_BY_ANIMAL,
  getAnimalForBreed,
  normalizeBreedValues,
  normalizeGeneralAnimalCoverage,
} from '@/lib/breed-taxonomy'

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
  breeds_specialised?: unknown
  has_visible_animals?: unknown
  breed_source?: unknown
}

export type ProviderPhotoInferenceResult = {
  breeds_general_inferred: string[]
  breeds_specialised: string[]
  analyzed_photo_count: number
  available_photo_count: number
  model: string
  breed_source: 'photo'
}

function buildPhotoPrompt(providerName: string) {
  const supportedDogBreeds = BREED_VALUES_BY_ANIMAL.dog.join(', ')
  const supportedCatBreeds = BREED_VALUES_BY_ANIMAL.cat.join(', ')
  const supportedRabbitBreeds = BREED_VALUES_BY_ANIMAL.rabbit.join(', ')

  return [
    `You are classifying Google business photos for "${providerName}".`,
    'Return JSON only in this shape:',
    '{"animals_present":["dog","cat"],"breeds_general_inferred":["dog","cat"],"breeds_specialised":["labrador retriever"],"has_visible_animals":true,"breed_source":"photo"}',
    'Rules:',
    '- Only allowed animals: dog, cat, rabbit.',
    '- Only include an animal if it is clearly visible in at least one photo.',
    '- If a clearly visible animal has a visually identifiable breed, add the best-guess breed to "breeds_specialised".',
    '- Leave "breeds_specialised" empty when the breed is unclear, obscured, mixed, too distant, or too uncertain.',
    '- Only use breed values from the supported taxonomy lists below.',
    '- Set "breed_source" to "photo" whenever you return breed guesses.',
    '- Ignore humans, tools, interiors, logos, text, and grooming equipment.',
    '- If no animal is clearly visible, return {"animals_present":[],"breeds_general_inferred":[],"breeds_specialised":[],"has_visible_animals":false,"breed_source":"photo"}.',
    `- Dog breeds: ${supportedDogBreeds}`,
    `- Cat breeds: ${supportedCatBreeds}`,
    `- Rabbit breeds: ${supportedRabbitBreeds}`,
  ].join('\n')
}

type PhotoClassificationResult = {
  breeds_general_inferred: string[]
  breeds_specialised: string[]
  breed_source: 'photo'
}

function mergeAnimalCoverage({
  animalsPresent,
  generalCoverage,
  breeds,
}: {
  animalsPresent: unknown
  generalCoverage: unknown
  breeds: string[]
}) {
  const coverage = new Set<string>([
    ...normalizeGeneralAnimalCoverage(animalsPresent),
    ...normalizeGeneralAnimalCoverage(generalCoverage),
  ])

  for (const breed of breeds) {
    const animal = getAnimalForBreed(breed)
    if (animal) {
      coverage.add(animal)
    }
  }

  return Array.from(coverage)
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

async function requestOpenAiPhotoClassification(
  providerName: string,
  imageUrls: string[]
): Promise<PhotoClassificationResult> {
  const key = process.env.OPENAI_API_KEY

  if (imageUrls.length === 0) {
    return {
      breeds_general_inferred: [],
      breeds_specialised: [],
      breed_source: 'photo',
    }
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
  const breedsSpecialised = normalizeBreedValues(parsed.breeds_specialised)

  return {
    breeds_general_inferred: mergeAnimalCoverage({
      animalsPresent: parsed.animals_present,
      generalCoverage: parsed.breeds_general_inferred,
      breeds: breedsSpecialised,
    }),
    breeds_specialised: breedsSpecialised,
    breed_source: parsed.breed_source === 'photo' ? 'photo' : 'photo',
  }
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
    const aggregatedBreeds = new Set<string>()
    let successfulSinglePhotoClassification = false
    let lastSingleError: unknown = combinedError

    for (const imageUrl of imageUrls) {
      try {
        const result = await requestOpenAiPhotoClassification(providerName, [imageUrl])
        successfulSinglePhotoClassification = true
        for (const animal of result.breeds_general_inferred) {
          aggregatedAnimals.add(animal)
        }
        for (const breed of result.breeds_specialised) {
          aggregatedBreeds.add(breed)
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

    return {
      breeds_general_inferred: Array.from(aggregatedAnimals),
      breeds_specialised: Array.from(aggregatedBreeds),
      breed_source: 'photo' as const,
    }
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
    imageUrls.length > 0
      ? await classifyAcrossPhotos(providerName, imageUrls)
      : {
          breeds_general_inferred: [],
          breeds_specialised: [],
          breed_source: 'photo' as const,
        }

  return {
    breeds_general_inferred: breeds_general_inferred.breeds_general_inferred,
    breeds_specialised: breeds_general_inferred.breeds_specialised,
    analyzed_photo_count: imageUrls.length,
    available_photo_count: selectedPhotos.length,
    model: PHOTO_ANALYSIS_MODEL,
    breed_source: breeds_general_inferred.breed_source,
  }
}
