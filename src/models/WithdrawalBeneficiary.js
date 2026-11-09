const {DataTypes}=require('sequelize');
const sequelize=require('../config/database');
module.exports=sequelize.define('WithdrawalBeneficiary',{
 id:{type:DataTypes.UUID,defaultValue:DataTypes.UUIDV4,primaryKey:true},
 user_id:{type:DataTypes.UUID,allowNull:false,references:{model:'users',key:'id'},onDelete:'RESTRICT'},
 full_name:{type:DataTypes.STRING(150),allowNull:false},
 phone:{type:DataTypes.STRING(20),allowNull:false},
 method:{type:DataTypes.STRING(20),allowNull:false},
 verified_at:{type:DataTypes.DATE,allowNull:true},
 deleted_at:{type:DataTypes.DATE,allowNull:true},
 verification_hash:{type:DataTypes.STRING(64),allowNull:true},
 verification_id:{type:DataTypes.UUID,allowNull:true},
 verification_email:{type:DataTypes.STRING(255),allowNull:true},
 expires_at:{type:DataTypes.DATE,allowNull:true},
 attempts:{type:DataTypes.INTEGER,allowNull:false,defaultValue:0},
 last_sent_at:{type:DataTypes.DATE,allowNull:true},
},{tableName:'withdrawal_beneficiaries',indexes:[{fields:['user_id','phone'],unique:true},{fields:['user_id','deleted_at']}]});
