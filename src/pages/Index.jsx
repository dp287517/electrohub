import { Link } from "react-router-dom";

export default function Index() {
  return (
    <div className="container-narrow text-center py-20">
      <h1 className="text-4xl font-bold mb-4">Welcome to ElectroHub</h1>
      <p className="text-gray-600 mb-12 max-w-2xl mx-auto">
        Your central platform for electrical asset management — integrating ATEX, Obsolescence,
        Selectivity, Fault Level Assessment, and Arc Flash analysis into one professional tool.
      </p>

      {/* Removed Create Account and Get Started buttons */}
      <div className="space-x-4">
        <Link
          to="/signin"
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          Sign In
        </Link>
      </div>

      <div className="mt-20">
        <p className="text-sm text-gray-500">
          © {new Date().getFullYear()} ElectroHub. All rights reserved.
        </p>
      </div>
    </div>
  );
}
