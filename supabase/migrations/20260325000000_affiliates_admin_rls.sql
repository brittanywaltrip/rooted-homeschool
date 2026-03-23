-- Allow admins to read all affiliate rows
CREATE POLICY "Admins can view all affiliates"
ON affiliates FOR SELECT
USING (
  auth.jwt() ->> 'email' IN ('garfieldbrittany@gmail.com', 'christopherwaltrip@gmail.com')
);
