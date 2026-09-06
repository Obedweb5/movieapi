import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div className="mx-auto flex max-w-md justify-center px-6 py-16">
      <SignUp />
    </div>
  );
}
