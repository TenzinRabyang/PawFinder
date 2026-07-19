import {
  Cat,
  Dog,
  MapPin,
  PawPrint,
  Rabbit,
  Scissors,
  Star,
  Stethoscope,
} from "lucide-react";
import EditorialPhoto from "@/components/home/EditorialPhoto";
import GetUpdatesModalTrigger from "@/components/home/GetUpdatesModalTrigger";
import HomeSearchCard from "@/components/home/HomeSearchCard";
import ScrollToSearchButton from "@/components/home/ScrollToSearchButton";

export const dynamic = "force-dynamic";

const homepageValueCards = [
  {
    title: "UK-Wide Coverage",
    description: "Powered by live Google data to find services anywhere.",
  },
  {
    title: "Breed-Specific",
    description: "Filter reviews written by owners of your exact breed.",
  },
  {
    title: "Temperament Filtering",
    description: "Find the perfect match for your pet's unique personality.",
  },
];

const petCategories = [
  {
    label: "Dogs",
    Icon: Dog,
  },
  {
    label: "Cats",
    Icon: Cat,
  },
  {
    label: "Rabbits",
    Icon: Rabbit,
  },
  {
    label: "Small pets",
    Icon: PawPrint,
  },
];

const serviceCards = [
  {
    title: "Vets who feel calm and capable",
    copy: "Compare clinics with real owner notes, booking links, and a quick sense of who handles anxious or routine care well.",
    icon: Stethoscope,
    imagePath: "/home/vet.png",
    imageAlt: "A vet examining a golden retriever in a bright clinic.",
    fallbackPrompt:
      "warm realistic veterinary clinic photograph, male vet in navy scrubs gently examining a calm golden retriever, bright clinical room, soft natural color, editorial pet care website, candid, professional",
    imageSize: "landscape_16_9" as const,
  },
  {
    title: "Groomers for regular maintenance",
    copy: "Spot gentle handling, specialist grooming options, and cat-friendly appointments without digging through generic listings.",
    icon: Scissors,
    imagePath: "/home/grooming.png",
    imageAlt: "A long-haired cat being gently groomed on a table.",
    fallbackPrompt:
      "realistic pet grooming photo, fluffy long haired cat being gently groomed on a table by a professional groomer, soft neutral studio light, close editorial crop, premium pet care website",
    imageSize: "landscape_4_3" as const,
  },
  {
    title: "Walkers for everyday routines",
    copy: "Find walking and daytime help near you, especially when you need consistent local cover for busy weeks.",
    icon: MapPin,
    imagePath: "/home/walking.png",
    imageAlt: "A group dog walking scene with several dogs on leads outdoors.",
    fallbackPrompt:
      "realistic dog walking group photo, several friendly dogs on leads with walkers outdoors in a city park, candid movement, natural daylight, warm editorial style for pet services website",
    imageSize: "landscape_16_9" as const,
  },
];

export default async function Home() {
  return (
    <div className="min-h-screen overflow-hidden bg-[#FAF7F1] text-[#20261F]">
      <section className="relative overflow-hidden pb-12 pt-6 sm:pb-20 sm:pt-14">
        <div className="absolute inset-x-0 top-0 h-[28rem] bg-[radial-gradient(circle_at_top,_rgba(177,74,43,0.09),_transparent_52%)]" />
        <div className="absolute left-[-8rem] top-28 h-56 w-56 rounded-full bg-[#E4E7DA] blur-3xl" />
        <div className="absolute right-[-6rem] top-10 h-60 w-60 rounded-full bg-[#F0DFD7] blur-3xl" />

        <div className="relative mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-4xl">
            <div className="mb-5 flex justify-end sm:mb-7">
              <GetUpdatesModalTrigger />
            </div>
            <div className="mb-7 sm:mb-10">
              <div className="relative mx-auto max-w-4xl">
                <div className="overflow-hidden rounded-[2rem] border border-[#DCD3BE] bg-[#F4EEE4] shadow-[0_28px_60px_-34px_rgba(32,38,31,0.4)]">
                  <EditorialPhoto
                    src="/home/hero.png"
                    alt="A woman cuddling a beagle."
                    imageSize="landscape_16_9"
                    fallbackPrompt="warm realistic editorial pet care photograph, close portrait of a young woman cuddling a calm beagle outdoors, soft natural light, intimate emotional moment, premium homepage hero image, shallow depth of field"
                    className="h-[280px] w-full object-cover sm:h-[420px] lg:h-[500px]"
                    priority
                  />
                </div>

                <div className="absolute bottom-3 right-3 w-[12.5rem] rotate-[-3deg] rounded-[1.25rem] border border-[#E7DDCA] bg-[#FFFCF8] p-3 shadow-[0_24px_45px_-28px_rgba(32,38,31,0.5)] sm:bottom-6 sm:right-6 sm:w-[16rem] sm:rounded-[1.4rem] sm:p-4">
                  <div className="mb-2 flex items-center gap-1 text-[#B14A2B]">
                    {Array.from({ length: 5 }).map((_, index) => (
                      <Star key={index} className="h-4 w-4 fill-current" />
                    ))}
                  </div>
                  <p className="text-xs leading-5 text-[#20261F] sm:text-sm sm:leading-6">
                    “The first sitter who actually asked about our rescue dog’s triggers before the meet-and-greet.”
                  </p>
                  <div className="mt-2 border-t border-[#EFE5D3] pt-2 text-[10px] uppercase tracking-[0.14em] text-[#4A5147] sm:mt-3 sm:pt-3 sm:text-xs sm:tracking-[0.16em]">
                    Imogen, Crookes · Beagle owner
                  </div>
                </div>
              </div>
            </div>

            <div className="mx-auto max-w-3xl text-center">
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-[#B14A2B] sm:mb-4 sm:text-sm">
                Local pet care, chosen with more context
              </p>
              <h1 className="mx-auto max-w-3xl font-display text-[2.125rem] leading-[1.02] tracking-[-0.035em] text-[#20261F] sm:text-[3.2rem] lg:text-[4rem]">
                Find <span className="italic text-[#B14A2B]">vetted</span> care that fits your pet, your postcode, and your routine.
              </h1>
              <p className="mx-auto mt-4 max-w-2xl text-[15px] leading-6 text-[#4A5147] sm:mt-5 sm:text-lg sm:leading-7">
                Search trusted vets, groomers, walkers, and sitters near you, with the kind of owner context that makes decisions easier.
              </p>
              <div className="mx-auto mt-7 max-w-2xl sm:mt-10">
                <HomeSearchCard inputId="homepage-search-input" />
              </div>
            </div>

            <div className="mx-auto mt-5 max-w-3xl rounded-[1.7rem] border border-[#DCD3BE] bg-white/80 p-3 shadow-[0_16px_36px_-28px_rgba(32,38,31,0.35)] backdrop-blur sm:mt-6">
              <div className="grid gap-2 sm:grid-cols-3">
                {homepageValueCards.map((card) => (
                  <div
                    key={card.title}
                    className="rounded-[1.25rem] border border-transparent px-4 py-4 text-center sm:border-[#EEE7D6] sm:bg-[#FFFDFC]"
                  >
                    <div className="font-display text-[1.45rem] leading-tight tracking-[-0.035em] text-[#20261F]">
                      {card.title}
                    </div>
                    <div className="mt-2 text-sm leading-6 text-[#4A5147]">{card.description}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="pb-14 sm:pb-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#B14A2B]">Browse by pet</p>
              <h2 className="mt-3 font-display text-[2rem] leading-tight tracking-[-0.03em] text-[#20261F] sm:text-[2.4rem]">
                What kind of pet do you have?
              </h2>
            </div>
          </div>

          <div className="-mx-4 mt-8 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
            <div className="flex min-w-max gap-3">
              {petCategories.map(({ label, Icon }) => (
                <div
                  key={label}
                  className="inline-flex cursor-default items-center gap-3 rounded-full border border-[#DCD3BE] bg-[#E4E7DA] px-4 py-3 text-sm font-medium text-[#20261F]"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#6E7C5B]">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="pr-1 text-base">{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="pb-20 sm:pb-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="rounded-[2.3rem] border border-[#DCD3BE] bg-white/75 p-5 shadow-[0_22px_45px_-30px_rgba(32,38,31,0.28)] backdrop-blur sm:p-8">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#B14A2B]">Care types</p>
              <h2 className="mt-3 font-display text-[2rem] leading-tight tracking-[-0.03em] text-[#20261F] sm:text-[2.5rem]">
                Choose the kind of help you actually need.
              </h2>
              <p className="mt-4 text-base leading-7 text-[#4A5147]">
                The homepage now leads with search, but these pathways still help orient first-time visitors toward the right type of care.
              </p>
            </div>

            <div className="mt-8 grid gap-5 lg:grid-cols-3">
              {serviceCards.map((card) => {
                const Icon = card.icon;

                return (
                  <article
                    key={card.title}
                    className="flex h-full flex-col overflow-hidden rounded-[1.8rem] border border-[#E6DECD] bg-[#FFFCF7]"
                  >
                    <EditorialPhoto
                      src={card.imagePath}
                      alt={card.imageAlt}
                      imageSize={card.imageSize}
                      fallbackPrompt={card.fallbackPrompt}
                      className="h-56 w-full object-cover"
                    />
                    <div className="flex flex-1 flex-col p-5">
                      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-[#E4E7DA] text-[#6E7C5B]">
                        <Icon className="h-5 w-5" />
                      </div>
                      <h3 className="font-display text-[1.6rem] leading-tight tracking-[-0.03em] text-[#20261F]">
                        {card.title}
                      </h3>
                      <p className="mt-3 flex-1 text-sm leading-7 text-[#4A5147]">{card.copy}</p>
                      <ScrollToSearchButton
                        targetId="homepage-search-input"
                        className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-[#B14A2B] transition hover:text-[#943920]"
                      >
                        Browse providers
                      </ScrollToSearchButton>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
