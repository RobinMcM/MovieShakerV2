import heroImage from './assets/hero.png'

function App() {
    return (
        <div className="relative min-h-screen w-full overflow-hidden bg-black font-sans text-white">
            {/* Background Image with Overlay */}
            <div
                className="absolute inset-0 z-0 bg-cover bg-center bg-no-repeat"
                style={{ backgroundImage: `url(${heroImage})` }}
            >
                <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" />
            </div>

            {/* Content */}
            <div className="relative z-10 flex min-h-screen flex-col items-center justify-center p-6 text-center">

                {/* Main Title Group */}
                <div className="space-y-2">
                    <h1 className="text-5xl font-black tracking-widest uppercase text-white drop-shadow-2xl sm:text-7xl md:text-8xl">
                        MovieShaker
                    </h1>
                    <p className="text-xl font-bold tracking-[0.2em] text-red-500 uppercase drop-shadow-lg sm:text-2xl md:text-3xl">
                        The Mean Indie Machine
                    </p>
                </div>



            </div>
        </div>
    )
}

export default App
