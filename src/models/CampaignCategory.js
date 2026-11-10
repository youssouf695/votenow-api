const {DataTypes}=require('sequelize');
const sequelize=require('../config/database');
module.exports=sequelize.define('CampaignCategory',{
 id:{type:DataTypes.UUID,defaultValue:DataTypes.UUIDV4,primaryKey:true},
 event_id:{type:DataTypes.UUID,allowNull:false,references:{model:'events',key:'id'},onDelete:'RESTRICT'},
 cover_image_url:{type:DataTypes.TEXT},avatar_url:{type:DataTypes.TEXT},
 name:{type:DataTypes.STRING(100),allowNull:false},position:{type:DataTypes.INTEGER,defaultValue:0},
},{tableName:'campaign_categories',indexes:[{fields:['event_id','name'],unique:true}]});
