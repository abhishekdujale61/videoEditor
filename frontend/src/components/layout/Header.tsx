import { Film } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function Header() {
  return (
    <header className="bg-gray-900 border-b border-gray-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link to="/" className="flex items-center gap-2 text-white no-underline">
            <Film className="w-8 h-8 text-purple-500" />
            <span className="text-xl font-bold">AI Video Editor</span>
          </Link>
          <nav className="flex items-center gap-4">
            <Link to="/" className="text-gray-300 hover:text-white text-sm no-underline">
              Home
            </Link>
          </nav>
        </div>
      </div>
    </header>
  );
}
