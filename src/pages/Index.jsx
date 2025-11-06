import { Link } from "react-router-dom";

export default function Index() {
  return (
    <div className="container-narrow text-center py-20 px-4 sm:px-6 lg:px-8">
      <h1 className="text-4xl sm:text-5xl font-extrabold mb-6 text-gray-900">
        Welcome to ElectroHub
      </h1>

      <p className="text-gray-600 mb-12 max-w-2xl mx-auto text-base sm:text-lg leading-relaxed">
        Your central platform for electrical asset management — integrating ATEX, Obsolescence,
        Selectivity, Fault Level Assessment, and Arc Flash analysis into one professional tool.
      </p>

      {/* Sign In button only */}
      <div className="flex justify-center">
        <Link
          to="/signin"
          className="px-8 py-3 text-white bg-blue-600 rounded-lg font-medium text-base sm:text-lg hover:bg-blue-700 shadow-md hover:shadow-lg transition-transform transform hover:scale-[1.02]"
        >
          Sign In
        </Link>
      </div>

      <footer className="mt-24 text-sm text-gray-500">
        © {new Date().getFullYear()} ElectroHub. All rights reserved.
      </footer>
    </div>
  );
}
