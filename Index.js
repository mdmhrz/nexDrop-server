// server.js
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

// Middlewares
app.use(cors());
app.use(express.json());

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

        // Test parcelsCollection
        app.get('/parcels', async (req, res) => {
            const parcels = await parcelsCollection.find().toArray();
            res.send(parcels);
        });

        //Parcels APi
        app.get('/parcels', async (req, res) => {
            const email = req.query.email;
            const filter = email ? { created_by: email } : {};
            const result = await parcels.find(filter).sort({ created_date: -1 }).toArray();
            res.send(result);
        });

        // Example POST in parcelsCollection
        // This endpoint allows you to add a new parcel to the database
        app.post('/parcels', async (req, res) => {
            const newParcel = req.body;
            const result = await parcelsCollection.insertOne(newParcel);
            res.send(result);
        });

        // DELETE /parcels/:id
        app.delete('/parcels/:id', async (req, res) => {
            const id = req.params.id;
            const result = await parcelsCollection.deleteOne({ _id: new ObjectId(id) });
            res.send(result);
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
