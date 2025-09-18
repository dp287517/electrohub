import { Link } from 'react-router-dom';

export default function Index() {
  return (
    <section className="relative">
      <div className="absolute inset-0 bg-gradient-to-b from-white via-brand-50/40 to-transparent pointer-events-none"></div>
      <div className="container-narrow py-16">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          <div>
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight">ElectroHub</h1>
            <p className="mt-4 text-gray-700 text-lg">
              A professional platform for electrical engineering workflows — ATEX, Obsolescence, Selectivity, Fault Level Assessment, and Arc Flash — with secure site-based data segregation.
            </p>
            <div className="mt-8 flex gap-3">
              <Link className="btn btn-primary" to="/signup">Get started</Link>
              <Link className="btn bg-gray-100" to="/signin">Sign in</Link>
            </div>
          </div>
          <div className="card p-8">
            <h3 className="text-xl font-semibold">Why ElectroHub?</h3>
            <ul className="mt-4 space-y-2 text-gray-700">
              <li>• Central dashboard with quick access cards</li>
              <li>• Role, Site & Department aware navigation</li>
              <li>• Ready to connect with OpenAI for smart assistance</li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
