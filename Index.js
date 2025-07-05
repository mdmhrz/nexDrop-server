// server.js
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const admin = require("firebase-admin");


const app = express();
const port = process.env.PORT || 5000;

// Middlewares
app.use(cors());
app.use(express.json());

//FB admin keys
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8');
// console.log(decoded);

const serviceAccount = JSON.parse(decoded)

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});





// MongoDB Connection
const uri = process.env.MONGO_URI;
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});
async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();

        const db = client.db('parcelDB');
        const parcelsCollection = db.collection('parcels');
        const paymentsCollection = db.collection('payments');
        const usersCollection = db.collection('users')
        const trackingCollection = db.collection('trackings');
        const ridersCollection = db.collection('riders')

        //Custom middlewares
        const verifyFBToken = async (req, res, next) => {
            const authHeaders = req.headers.authorization;
            if (!authHeaders) {
                return res.status(401).send({ message: 'Unauthorized Access' })
            }

            const token = authHeaders.split(' ')[1]
            if (!token) {
                return res.status(401).send({ message: 'Unauthorized Access' })
            }

            //Verify the token
            try {
                const decoded = await admin.auth().verifyIdToken(token);
                req.decoded = decoded;
                next()
            }
            catch (error) {
                return res.status(403).send({ message: 'Forbidden access' })
            }
        }



        // Test parcelsCollection
        app.get('/parcels', verifyFBToken, async (req, res) => {
            const parcels = await parcelsCollection.find().toArray();
            res.send(parcels);
        });




        //Parcels APi by email id
        app.get('/parcels/user', verifyFBToken, async (req, res) => {
            const email = req.query.email;
            const filter = email ? { created_by: email } : {};
            const result = await parcelsCollection.find(filter).sort({ created_date: -1 }).toArray();
            res.send(result);
        });



        // GET single parcel by ID
        app.get('/parcels/:id', verifyFBToken, async (req, res) => {
            const id = req.params.id;
            const parcel = await parcelsCollection.findOne({ _id: new ObjectId(id) });
            res.send(parcel);
        });




        // Example POST in parcelsCollection
        // This endpoint allows you to add a new parcel to the database
        app.post('/parcels', async (req, res) => {
            const newParcel = req.body;
            const result = await parcelsCollection.insertOne(newParcel);
            res.send(result);
        });




        // for payment confirmation from stripe
        app.post('/create-payment-intent', async (req, res) => {
            const amountInCents = req.body.amountInCents;

            const paymentIntent = await stripe.paymentIntents.create({
                amount: amountInCents, // Stripe works in cents
                currency: 'usd', // or 'bdt' if applicable for test
                payment_method_types: ['card'],
            });

            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        });




        // DELETE /parcels/:id
        app.delete('/parcels/:id', async (req, res) => {
            const id = req.params.id;
            const result = await parcelsCollection.deleteOne({ _id: new ObjectId(id) });
            res.send(result);
        });



        // ******************************************//
        // ******  User Related APIs  ********//
        // ******************************************//

        // 🔍 Search user by partial/full email
        app.get('/users/search', async (req, res) => {
            const emailQuery = req.query.email;
            if (!emailQuery) {
                return res.status(400).send({ error: 'Email query is required' });
            }

            try {
                const user = await usersCollection
                    .find(
                        { email: { $regex: emailQuery, $options: 'i' } }, // case-insensitive partial match
                        { projection: { email: 1, created_at: 1, role: 1 } }
                    ).limit(10).toArray();

                if (!user) {
                    return res.status(404).send({ message: "User not found" });
                }

                res.send(user);
            } catch (err) {
                res.status(500).send({ error: 'Error searching user' });
            }
        });




        // Get user role by email
        app.get('/users/role', async (req, res) => {
            const { email } = req.query;

            if (!email) {
                return res.status(400).send({ error: 'Email query parameter is required' });
            }

            try {
                const user = await usersCollection.findOne(
                    { email },
                    { projection: { role: 1 } } // Only fetch the role field
                );

                if (!user) {
                    return res.status(404).send({ error: 'User not found' });
                }

                res.send({ role: user.role });
            } catch (err) {
                res.status(500).send({ error: 'Failed to get user role' });
            }
        });





        // Make user admin
        app.patch('/users/make-admin/:id', async (req, res) => {
            const id = req.params.id;

            try {
                const result = await usersCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { role: 'admin' } }
                );

                res.send(result);
            } catch (err) {
                res.status(500).send({ error: 'Failed to make user admin' });
            }
        });





        // Remove admin role (make user regular)
        app.patch('/users/remove-admin/:id', async (req, res) => {
            const id = req.params.id;

            try {
                const result = await usersCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { role: 'user' } }
                );

                if (result.modifiedCount > 0) {
                    res.send({ success: true, message: "Admin access removed." });
                } else {
                    res.status(404).send({ success: false, message: "User not found or already a user." });
                }
            } catch (err) {
                res.status(500).send({ error: 'Failed to remove admin access' });
            }
        });





        //Add user in User Collection when a user register
        app.post('/users', async (req, res) => {
            const email = req.body.email;

            const userExists = await usersCollection.findOne({ email })
            if (userExists) {
                return res.status(200).send({ message: 'User already exist', inserted: false })
            }

            const user = req.body;
            const result = await usersCollection.insertOne(user);
            res.send(result)
        })



        // ******************************************//
        // ******  Tracking Related APIs  ********//
        // ******************************************//

        app.post('tracking', async (req, res) => {
            const { tracking_id, parcel_id, status, message, updated_by = '' } = req.body;

            const log = {
                tracking_id,
                parcel_id: parcel_id ? new ObjectId(parcel_id) : undefined,
                status,
                message,
                timme: new Date(),
                updated_by,
            }

            const result = await trackingCollection.insertOne(log);
            res.send({ success: true, insertedId: result.insertedId })
        })


        // ******************************************//
        // ******  Payment Related APIs  ********//
        // ******************************************//


        //Payments related APIs
        // Get Api for payments history by email
        app.get('/payments/user', verifyFBToken, async (req, res) => {
            const email = req.query.email;

            if (!email) {
                return res.status(400).send({ error: 'Email is required' });
            }

            const result = await paymentsCollection
                .find({ email }) // exact match
                .sort({ paid_at: -1 }) // latest first
                .toArray();

            res.send(result);
        });

        // Get api for all payments history from payment collection
        app.get('/payments', async (req, res) => {
            const result = await paymentsCollection
                .find()
                .sort({ createdAt: -1 })
                .toArray();
            res.send(result);
        });



        //Post api for payments and update parcels collection payment status
        app.post('/payments', async (req, res) => {
            const { parcelId, email, amount, paymentMethod, transactionId } = req.body;

            // Step 1: Mark parcel as paid
            const updateResult = await parcelsCollection.updateOne(
                { _id: new ObjectId(parcelId) },
                {
                    $set: {
                        isPaid: true,
                        paymentMethod: paymentMethod || 'unknown'
                    }
                }
            );

            // Step 2: Save payment history
            const paymentEntry = {
                parcelId: new ObjectId(parcelId),
                email, // user email
                amount,
                paymentMethod,
                transactionId,
                paid_at: new Date(),
                paid_at_string: new Date().toISOString()
            };

            const insertResult = await paymentsCollection.insertOne(paymentEntry);

            res.send({
                message: 'Payment recorder and parcel marked as paid',
                insertdId: insertResult.insertedId
            });
        });

        // ******************************************//
        // ******  Riders Related APIs  ********//
        // ******************************************//

        //Pending riders list 
        app.get('/riders/pending', async (req, res) => {
            try {
                const pendingRiders = await ridersCollection.find({ status: "pending" }).toArray();
                res.send(pendingRiders);
            } catch (error) {
                console.error("Failed to fetch pending riders:", error);
                res.status(500).send({ error: "Internal server error" });
            }
        });

        // GET /riders/active
        app.get('/riders/active', async (req, res) => {
            try {
                const activeRiders = await ridersCollection.find({ status: 'active' }).toArray();
                res.send(activeRiders);
            } catch (error) {
                console.error("Error fetching active riders:", error);
                res.status(500).send({ error: 'Failed to fetch active riders' });
            }
        });



        //for create riders application
        app.post('/riders', async (req, res) => {
            const rider = req.body;
            const result = await ridersCollection.insertOne(rider);
            res.send(result)
        })


        //Put and patch for updating data

        // PATCH /riders/approve/:id
        app.patch('/riders/approve/:id', async (req, res) => {
            const id = req.params.id;
            const { status, email } = req.body;

            // console.log(status, email);
            try {

                const result = await ridersCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { status: "active" } }
                );

                //update user role for accepted rider
                if (status === 'active') {
                    const userQuery = { email };
                    const userUpdatedDoc = {
                        $set: {
                            role: 'rider'
                        }
                    }
                    const roleResult = await usersCollection.updateOne(userQuery, userUpdatedDoc)
                    console.log(roleResult.modifiedCount);
                }



                res.send(result);
            } catch (error) {
                res.status(500).send({ error: 'Failed to approve rider' });
            }
        });

        // PATCH /riders/cancel/:id
        app.patch('/riders/cancel/:id', async (req, res) => {
            const id = req.params.id;
            try {
                const result = await ridersCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { status: "cancelled" } }
                );

                res.send(result);
            } catch (error) {
                res.status(500).send({ error: 'Failed to cancel rider' });
            }
        });

        // PATCH /riders/cancel/:id
        app.patch('/riders/deactivate/:id', async (req, res) => {
            try {
                const id = req.params.id;
                const result = await ridersCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { status: 'deactivated' } }
                );
                res.send(result);
            } catch (error) {
                console.error("Error deactivating rider:", error);
                res.status(500).send({ error: 'Failed to deactivate rider' });
            }
        });









        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


app.get('/', async (req, res) => {
    res.send('Welcome to the Parcel Delivery Server');

});


// Start server
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
