export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-r from-blue-500 to-green-500 flex flex-col items-center justify-center text-white">
      <h1 className="text-5xl font-bold mb-4">Welcome to ElectroHub</h1>
      <p className="text-xl mb-8">Your professional app for electricians.</p>
      <div className="space-x-4">
        <a href="/signin" className="bg-white text-blue-500 px-6 py-3 rounded-lg font-semibold hover:bg-gray-100">
          Sign In
        </a>
        <a href="/signup" className="bg-transparent border-2 border-white px-6 py-3 rounded-lg font-semibold hover:bg-white hover:text-blue-500">
          Sign Up
        </a>
      </div>
    </div>
  );
}
