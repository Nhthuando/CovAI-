import { useState, useEffect } from 'react';

/**
 * Custom hook to detect if a media query matches.
 * @param {string} query - The media query string.
 * @returns {boolean} - Whether the media query matches.
 */
export function useMediaQuery(query) {
    const [matches, setMatches] = useState(false);

    useEffect(() => {
        const mediaQuery = window.matchMedia(query);
        setMatches(mediaQuery.matches);

        const handler = (event) => {
            setMatches(event.matches);
        };

        mediaQuery.addEventListener('change', handler);
        return () => {
            mediaQuery.removeEventListener('change', handler);
        };
    }, [query]);

    return matches;
}

/**
 * Predefined breakpoint hooks.
 */
export function useBreakpoints() {
    const isMobile = useMediaQuery('(max-width: 767px)');
    const isTablet = useMediaQuery('(min-width: 768px) and (max-width: 1023px)');
    const isLaptop = useMediaQuery('(min-width: 1024px) and (max-width: 1439px)');
    const isDesktop = useMediaQuery('(min-width: 1440px)');
    const isLandscape = useMediaQuery('(orientation: landscape)');
    const isPortrait = useMediaQuery('(orientation: portrait)');

    return {
        isMobile,
        isTablet,
        isLaptop,
        isDesktop,
        isLandscape,
        isPortrait,
    };
}