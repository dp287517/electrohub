export default function AuthCard({ title, subtitle, children }) {
  return (
    <div className="container-narrow">
      <div className="grid md:grid-cols-2 gap-10 py-12 items-center">
        <div className="hidden md:block">
          <div className="relative">
            <div className="absolute -inset-10 bg-gradient-to-br from-brand-100 via-white to-transparent rounded-[2rem] blur-2xl"></div>
            <div className="card p-8 relative">
              <h2 className="text-2xl font-semibold mb-4">Built for Electrical Excellence</h2>
              <p className="text-gray-600 leading-relaxed">
                ElectroHub centralizes ATEX, Obsolescence, Selectivity, Fault Level Assessment, and Arc Flash workflows. Secure, site-scoped data. Fast. Professional.
              </p>
              <ul className="mt-6 space-y-2 text-gray-700">
                <li>• Site & Department based access</li>
                <li>• Neon + Render ready</li>
                <li>• Modern, responsive UI</li>
              </ul>
            </div>
          </div>
        </div>
        <div className="card p-8">
          <h1 className="text-3xl font-bold mb-2">{title}</h1>
          <p className="text-gray-600 mb-8">{subtitle}</p>
          {children}
        </div>
      </div>
    </div>
  );
}
