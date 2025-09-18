export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-600 to-teal-500 flex flex-col items-center justify-center text-white px-4">
      <h1 className="text-4xl md:text-6xl font-extrabold mb-6 text-center">Welcome to ElectroHub</h1>
      <p className="text-lg md:text-2xl mb-10 text-center max-w-2xl">
        The ultimate professional platform for electricians to manage switchboards and more.
      </p>
      <div className="flex flex-col sm:flex-row space-y-4 sm:space-y-0 sm:space-x-6">
        <a
          href="/signin"
          className="bg-white text-blue-600 px-8 py-3 rounded-full font-semibold text-lg hover:bg-blue-100 transition duration-300"
        >
          Sign In
        </a>
        <a
          href="/signup"
          className="bg-transparent border-2 border-white px-8 py-3 rounded-full font-semibold text-lg hover:bg-white hover:text-blue-600 transition duration-300"
        >
          Sign Up
        </a>
      </div>
    </div>
  );
}
