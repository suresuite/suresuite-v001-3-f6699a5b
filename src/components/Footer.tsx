import React from "react";

interface FooterProps {
  isCollapsed?: boolean;
  hasNavBar?: boolean;
}

const Footer: React.FC<FooterProps> = ({ isCollapsed = false, hasNavBar = true }) => (
  <footer className="fixed bottom-0 left-0 right-0 z-50">
    <div
      className={`text-white px-3 py-2 text-xs text-center transition-all duration-500 ${
        hasNavBar ? (isCollapsed ? "ml-14" : "ml-0 sm:ml-48") : ""
      }`}
      style={{
        backgroundImage:
          "linear-gradient(to right, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.50) 10%, rgba(0,0,0,0.56) 22%, rgba(0,0,0,0.61) 34%, rgba(0,0,0,0.66) 44%, rgba(0,0,0,0.68) 50%, rgba(0,0,0,0.66) 56%, rgba(0,0,0,0.61) 66%, rgba(0,0,0,0.56) 78%, rgba(0,0,0,0.50) 90%, rgba(0,0,0,0.45) 100%)",
        WebkitBackdropFilter: "blur(8px)",
        backdropFilter: "blur(8px)",
        textShadow: "0 1px 2px rgba(0,0,0,0.55)",
      }}
    >
      Developed by <span className="font-semibold">Phu Nguyen</span> &{" "}
      <span className="font-semibold">Prof. Dmitry Ivanov</span> (HWR Berlin) · WP4 - ACCURATE project, funded by the European Union
    </div>
  </footer>
);

export default Footer;