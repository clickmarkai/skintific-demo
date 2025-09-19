import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { Link, useNavigate } from "react-router-dom";

const LoginPage = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // Sign in with Supabase Auth
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        setError(authError.message);
        return;
      }

      if (authData.user) {
        // First, ensure the user exists in the users table
        const { data: existingUser, error: userError } = await supabase
          .from('users')
          .select('id')
          .eq('id', authData.user.id)
          .single();

        if (userError && userError.code === 'PGRST116') {
          // User doesn't exist in users table, create them
          const { error: createUserError } = await supabase
            .from('users')
            .insert({
              id: authData.user.id,
              email: authData.user.email,
              source: 'web',
              consent_email: true,
              created_at: new Date().toISOString()
            });

          if (createUserError) {
            console.error('Error creating user:', createUserError);
            setError('Failed to create user account. Please try again.');
            return;
          }
        } else if (userError) {
          console.error('Error checking user:', userError);
          setError('Database error. Please try again.');
          return;
        }

        // Check if session already exists, if not create one
        const { data: existingSession } = await supabase
          .from('sessions')
          .select('id')
          .eq('user_id', authData.user.id)
          .order('started_at', { ascending: false })
          .limit(1)
          .single();

        if (!existingSession) {
          // Only create session if one doesn't exist
          const { error: sessionError } = await supabase
            .from('sessions')
            .insert({
              user_id: authData.user.id,
              channel: 'web',
              started_at: new Date().toISOString(),
              last_seen_at: new Date().toISOString(),
              locale: 'en'
            });

          if (sessionError) {
            console.error('Error creating session:', sessionError);
            // Don't fail login if session creation fails, but log it
          }
        }

        // Call the login function from auth context
        await login(authData.user);
        
        // Redirect to home page after successful login
        navigate('/');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-black mb-2">SKINTIFIC</h1>
          <p className="text-gray-600">Sign in to your account</p>
        </div>
        
        <Card>
          <CardHeader>
            <CardTitle>Login</CardTitle>
            <CardDescription>
              Enter your email and password to access your account
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="Enter your email"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="Enter your password"
                />
              </div>

              {error && (
                <div className="text-red-600 text-sm bg-red-50 p-3 rounded-md">
                  {error}
                </div>
              )}

              <Button 
                type="submit" 
                className="w-full bg-pink-600 hover:bg-pink-700 text-white"
                disabled={loading}
              >
                {loading ? "Signing in..." : "Sign In"}
              </Button>
            </form>
            
            <div className="mt-4 text-center">
              <p className="text-sm text-gray-600">
                Don't have an account?{" "}
                <Link to="/register" className="text-pink-600 hover:text-pink-700 font-medium">
                  Create one here
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default LoginPage;
