import { Clapperboard } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function Header() {
  return (
    <header className="sticky top-0 z-50 bg-gray-950/90 backdrop-blur-md border-b border-gray-800/60">
      <div className="max-w-3xl mx-auto px-4">
        <div className="flex items-center justify-between h-14">
          <Link to="/" className="flex items-center gap-2.5 text-white no-underline group">
            <div className="w-8 h-8 rounded-lg bg-purple-600 flex items-center justify-center shadow-md shadow-purple-900/40 group-hover:bg-purple-500 transition-colors">
              <Clapperboard className="w-4 h-4 text-white" />
            </div>
            <span className="text-base font-bold tracking-tight">Vector Studio</span>
          </Link>
          <Link
            to="/"
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors font-medium"
          >
            New Project
          </Link>
        </div>
      </div>
    </header>
  );
}
