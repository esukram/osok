const Fibonacci = (fib: number) : number => {
  if (fib <= 1) return 1;

  return Fibonacci(fib-1) + Fibonacci(fib-2);
}

export default Fibonacci;

