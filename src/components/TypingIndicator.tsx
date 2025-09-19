const TypingIndicator = () => {
  return (
    <div className="flex justify-start animate-fade-in">
      <div className="bg-gray-100 border border-gray-200 rounded-lg px-4 py-3 max-w-[80px]">
        <div className="flex items-center space-x-1">
          <div 
            className="w-2 h-2 bg-gray-400 rounded-full animate-typing-dots"
            style={{ animationDelay: '0ms' }}
          ></div>
          <div 
            className="w-2 h-2 bg-gray-400 rounded-full animate-typing-dots"
            style={{ animationDelay: '200ms' }}
          ></div>
          <div 
            className="w-2 h-2 bg-gray-400 rounded-full animate-typing-dots"
            style={{ animationDelay: '400ms' }}
          ></div>
        </div>
      </div>
    </div>
  );
};

export default TypingIndicator;