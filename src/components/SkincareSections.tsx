import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from "@/components/ui/carousel";

const communityVideos: string[] = [
  "https://cdn.shopify.com/videos/c/o/v/f3f90a0369a7470baba1ded4395dc8fa.mp4",
  "https://cdn.shopify.com/videos/c/o/v/64a5bc6470d84387b137f60396da092c.mp4",
  "https://cdn.shopify.com/videos/c/o/v/ccd62a1cbc5346f788f42ca4cbac85e4.mp4",
  "https://cdn.shopify.com/videos/c/o/v/095a5f2efc994033b61be35ba307ad55.mp4",
  "https://cdn.shopify.com/videos/c/o/v/f3f90a0369a7470baba1ded4395dc8fa.mp4",
  "https://cdn.shopify.com/videos/c/o/v/54cdb2d653654a63903798213a4347ec.mp4",
];

const SkincareSections = () => {
  const [ingredientApi, setIngredientApi] = useState<CarouselApi | undefined>();
  const [activeIngredientIndex, setActiveIngredientIndex] = useState(0);

  useEffect(() => {
    if (!ingredientApi) return;
    const onSelect = () => setActiveIngredientIndex(ingredientApi.selectedScrollSnap());
    onSelect();
    ingredientApi.on("select", onSelect);
    return () => {
      ingredientApi.off("select", onSelect);
    };
  }, [ingredientApi]);
  return (
    <div className="bg-white">
      {/* MOST LOVED IN OUR COMMUNITY */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl md:text-4xl font-bold text-black mb-8 text-center">
            MOST LOVED IN OUR COMMUNITY
          </h2>

          <Carousel opts={{ dragFree: true, align: "start" }}>
            <CarouselContent>
              {communityVideos.map((src, i) => (
                <CarouselItem key={i} className="basis-3/4 md:basis-1/3 lg:basis-1/6">
                  <div className="flex flex-col">
                    <div className="relative rounded-xl overflow-hidden">
                      <video
                        src={src}
                        playsInline
                        autoPlay
                        muted
                        loop
                        preload="metadata"
                        className="block w-full h-auto rounded-xl"
                        aria-label="Community favorite product video"
                        controls={false}
                        disablePictureInPicture
                        controlsList="nodownload noplaybackrate nofullscreen"
                      />
                      <div className="absolute left-3 bottom-3 text-[10px] uppercase tracking-wide text-white bg-black/60 px-2 py-1 rounded">
                        Autoplay • Muted • Loop
                      </div>
                    </div>
                    <div className="mt-3">
                      <h3 className="font-semibold text-black text-sm line-clamp-2 mb-1">5X Ceramide Barrier Repair Moisture Gel</h3>
                      <div className="text-gray-900 font-semibold mb-1">Rp 139.000,00</div>
                      <div className="text-yellow-500 text-sm mb-3">★★★★★ <span className="text-xs text-gray-500">5.0</span></div>
                      <Button className="w-full bg-black hover:bg-black text-white">Add To cart</Button>
                    </div>
                  </div>
                </CarouselItem>
              ))}
            </CarouselContent>
            <CarouselPrevious className="bg-white shadow" />
            <CarouselNext className="bg-white shadow" />
          </Carousel>
        </div>
      </section>


      {/* SKINTIFIC 5X SERIES Section */}
      <section className="py-16 bg-white">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-12 gap-12 items-center">
            <div className="md:col-span-7">
              <img
                src="https://skintific.com/cdn/shop/files/S-01_05_12_13_56_5X_5X_5X_5X_5X_-_2.jpg?v=1750058263&width=5079"
                alt="SKINTIFIC 5X Series"
                className="w-full h-auto rounded-xl"
              />
            </div>
            <div className="md:col-span-5 ml-20">
              <h2 className="text-3xl md:text-3xl font-bold text-black mb-6 tracking-tight">
                SKINTIFIC 5X SERIES
              </h2>
              <ul className="list-disc pl-6 space-y-4 text-black text-lg font-bold w-[400px]">
                <li>Helps support and strengthen the skin barrier</li>
                <li>Formulated to address common skin concerns</li>
                <li>Helps soothe and hydrate the skin</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Target Your Skin Needs */}
      <section className="py-16">
        <div className="mx-[60px] px-4">
          <h2 className="text-2xl md:text-2xl text-black mb-8 text-center">TARGET YOUR SKIN NEEDS</h2>
          <div className="grid md:grid-cols-4 gap-2">
            {[
              { title: "REPAIRING", src: "https://skintific.com/cdn/shop/files/gempages_572779726456750976-2cb5ed49-8be0-47c4-9bc2-7fd67a0b054f_239a289e-ea0e-4948-82f2-c3710ba37137.jpg?v=1753084606&width=3648" },
              { title: "BRIGHTENING", src: "https://skintific.com/cdn/shop/files/S-44_21_04_18_f4281db4-11eb-4ae2-ba57-ad76c95a1d26.jpg?v=1753086241&width=1333" },
              { title: "COVERAGE", src: "https://skintific.com/cdn/shop/files/S134_160_161_230_246.jpg?v=1753086218&width=1735" },
              { title: "ANTI ACNE", src: "https://skintific.com/cdn/shop/files/cfea4fc1fcddd893776c1c47aefaa18d.jpg?v=1753086199&width=3644" },
            ].map((t) => (
              <div key={t.title} className="relative rounded-sm overflow-hidden group">
                <img
                  src={t.src}
                  alt={t.title}
                  className="w-full h-80 object-cover transition-transform group-hover:scale-[1.03]"
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-white text-2xl tracking-wide">{t.title}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Hero Ingredient carousel - full-width cards with overlay text */}
      <section className="py-16 bg-white">
        <div className="container mx-auto px-4">
          <h2 className="text-2xl md:text-2xl text-black mb-8 text-center">HERO INGREDIENT</h2>
          <Carousel opts={{ loop: true, align: "center" }} setApi={setIngredientApi}>
            <CarouselContent>
              {[
                {
                  title: "5X Ceramides",
                  desc: "Strengthens the skin barrier, locks in moisture, and prevents dryness.",
                  img: "https://skintific.com/cdn/shop/files/5_f834a04a-93ab-4a66-9181-39f22b569299.jpg?v=1750060342&width=1500",
                },
                {
                  title: "Retinol",
                  desc: "Boosts cell turnover, reduces wrinkles, improves texture, and enhances collagen.",
                  img: "https://skintific.com/cdn/shop/files/24_bbd2f2d7-bd94-495f-abad-b23f5a2e38e3.jpg?v=1750060346&width=1500",
                },
                {
                  title: "377 SYMWHITE",
                  desc: "Brightens skin, reduces dark spots, and evens out skin tone.",
                  img: "https://skintific.com/cdn/shop/files/377_9f9a541f-3085-4c10-af54-751d021df9b6.jpg?v=1750060346&width=1500",
                },
              ].map((s, idx) => {
                const isActive = idx === activeIngredientIndex;
                const overlay = isActive ? "bg-white/30" : "bg-white/70";
                const titleColor = isActive ? "text-black" : "text-black/40";
                const descColor = isActive ? "text-black/80" : "text-black/40";
                return (
                  <CarouselItem key={s.title} className="basis-[88%] md:basis-[85%]">
                    <div className={`relative h-[600px] md:h-[600px] rounded-xl overflow-hidden transition-all duration-500 ${isActive ? '' : 'scale-[0.985]'}`}>
                      <img src={s.img} alt={s.title} className="absolute inset-0 w-full h-full object-cover" />
                      <div className={`absolute inset-0 ${overlay}`} />
                      <div className="relative p-8 md:p-12">
                        <h3 className={`text-2xl md:text-2xl font-bold mb-3 ${titleColor}`}>{s.title}</h3>
                        <p className={`md:text-lg max-w-3xl ${descColor}`}>{s.desc}</p>
                      </div>
                    </div>
                  </CarouselItem>
                );
              })}
            </CarouselContent>
          </Carousel>
        </div>
      </section>
      
      {/* Full-width brand video */}
      <section className="py-0">
        <div className="relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] w-screen">
          <video
            src="https://skintific.com/cdn/shop/videos/c/vp/dce3d2dce8364936bf50ff886624af1b/dce3d2dce8364936bf50ff886624af1b.HD-1080p-2.5Mbps-49734418.mp4?v=0"
            playsInline
            autoPlay
            muted
            loop
            preload="metadata"
            className="w-screen h-auto"
            controls={false}
          />
        </div>
      </section>
    </div>
  );
};

export default SkincareSections;
